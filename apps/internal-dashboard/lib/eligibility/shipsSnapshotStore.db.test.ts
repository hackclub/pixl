import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { buildSnapshot } from "./ships";
import { createShipsSnapshotStore } from "./shipsSnapshotStore";

const databaseUrl = process.env.PIXL_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const migration = readFileSync(join(import.meta.dir, "../../../server/drizzle/0231_ships_snapshot.sql"), "utf8");

const record = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  ysws: "PIXL",
  approved_at: 1_790_000_000,
  hours: 4,
  code_url: `https://github.com/example/${id}`,
  github_username: "example",
  slack_id: "U123456",
  display_name: "must not be persisted",
  ...over,
});

suite("Ships snapshot Postgres store", () => {
  const db = postgres(databaseUrl!, { max: 4, onnotice: () => {} });
  const store = createShipsSnapshotStore(db);

  beforeAll(async () => {
    await db.unsafe(migration);
  });

  beforeEach(async () => {
    await db`
      update ships_snapshot_state set
        active_snapshot_id = null,
        last_attempt_at_ms = null,
        last_success_at_ms = null,
        last_error = null,
        consecutive_failures = 0,
        next_retry_at_ms = null,
        last_duration_ms = null,
        refresh_token = null,
        refresh_lease_until_ms = null
      where singleton = true`;
    await db`delete from ships_snapshots`;
  });

  afterAll(async () => {
    await db.end({ timeout: 2 });
  });

  test("stores only indexed PIXL fields and reads the committed active generation", async () => {
    const candidate = buildSnapshot(
      [record("recAAAAAAAAAAAAAA"), { ...record("recBBBBBBBBBBBBBB"), ysws: "Macondo" }],
      1000,
      456,
    );
    const token = randomUUID();
    expect(await store.acquire({ token, now: 1000, ttlMs: 1, leaseMs: 60_000, force: true })).toEqual({ acquired: true });
    const id = await store.activate({ token, snapshot: candidate, etag: '"v1"', durationMs: 42 });
    const state = await store.read();

    expect(state.snapshot).toMatchObject({
      id,
      fetchedAt: 1000,
      etag: '"v1"',
      totalReturned: 2,
      pixlCount: 1,
      bytes: 456,
    });
    expect(state.snapshot!.entries).toHaveLength(1);
    expect(state.snapshot!.entries[0]).toMatchObject({ id: "recAAAAAAAAAAAAAA", hours: 4, slackId: "U123456" });
    expect(Object.keys(state.snapshot!.entries[0]!).sort()).toEqual([
      "approvedAt",
      "codeUrl",
      "githubUsername",
      "hours",
      "id",
      "repoKey",
      "slackId",
    ]);
    expect(state.lastSuccessAt).toBe(1000);
    expect(state.error).toBeNull();
  });

  test("a failed refresh keeps the previous generation and records persistent retry diagnostics", async () => {
    const firstToken = randomUUID();
    const first = buildSnapshot([record("recAAAAAAAAAAAAAA")], 1000, 100);
    await store.acquire({ token: firstToken, now: 1000, ttlMs: 1, leaseMs: 60_000, force: true });
    const activeId = await store.activate({ token: firstToken, snapshot: first, etag: null, durationMs: 10 });

    const secondToken = randomUUID();
    await store.acquire({ token: secondToken, now: 31_001, ttlMs: 1000, leaseMs: 60_000, force: true });
    await store.fail({ token: secondToken, now: 31_001, error: "Ships returned HTTP 503", durationMs: 250 });
    const failed = await store.read();
    expect(failed.snapshot!.id).toBe(activeId);
    expect(failed.snapshot!.fetchedAt).toBe(1000);
    expect(failed.lastSuccessAt).toBe(1000);
    expect(failed.lastAttemptAt).toBe(31_001);
    expect(failed.error).toBe("Ships returned HTTP 503");
    expect(failed.consecutiveFailures).toBe(1);
    expect(failed.nextRetryAt).toBe(61_001);

    const backedOff = await store.acquire({ token: randomUUID(), now: 61_000, ttlMs: 1000, leaseMs: 60_000, force: false });
    expect(backedOff).toEqual({ acquired: false, reason: "backoff" });
    const retry = await store.acquire({ token: randomUUID(), now: 61_001, ttlMs: 1000, leaseMs: 60_000, force: false });
    expect(retry).toEqual({ acquired: true });
  });

  test("a lease admits one concurrent refresher and expires after a crashed worker", async () => {
    const [a, b] = await Promise.all([
      store.acquire({ token: randomUUID(), now: 1000, ttlMs: 1, leaseMs: 1000, force: true }),
      store.acquire({ token: randomUUID(), now: 1000, ttlMs: 1, leaseMs: 1000, force: true }),
    ]);
    expect([a, b].filter((result) => result.acquired)).toHaveLength(1);
    expect([a, b].filter((result) => !result.acquired && result.reason === "busy")).toHaveLength(1);
    expect(await store.acquire({ token: randomUUID(), now: 2000, ttlMs: 1, leaseMs: 1000, force: true })).toEqual({ acquired: true });
  });

  test("an activation transaction failure cannot move the active pointer", async () => {
    const firstToken = randomUUID();
    const first = buildSnapshot([record("recAAAAAAAAAAAAAA")], 1000, 100);
    await store.acquire({ token: firstToken, now: 1000, ttlMs: 1, leaseMs: 60_000, force: true });
    const activeId = await store.activate({ token: firstToken, snapshot: first, etag: null, durationMs: 10 });

    const secondToken = randomUUID();
    await store.acquire({ token: secondToken, now: 2000, ttlMs: 1, leaseMs: 60_000, force: true });
    const malformed = {
      ...first,
      fetchedAt: 2000,
      byId: new Map([["recAAAAAAAAAAAAAA", { ...first.byId.get("recAAAAAAAAAAAAAA")!, hours: -1 }]]),
    };
    await expect(store.activate({ token: secondToken, snapshot: malformed, etag: null, durationMs: 15 })).rejects.toThrow();
    await store.fail({ token: secondToken, now: 2000, error: "activation failed", durationMs: 15 });

    const after = await store.read();
    expect(after.snapshot!.id).toBe(activeId);
    expect(after.snapshot!.fetchedAt).toBe(1000);
    expect(after.error).toBe("activation failed");
  });

  test("a 304 renews the existing snapshot without replacing its records", async () => {
    const token = randomUUID();
    const original = buildSnapshot([record("recAAAAAAAAAAAAAA")], 1000, 100);
    await store.acquire({ token, now: 1000, ttlMs: 1, leaseMs: 60_000, force: true });
    const activeId = await store.activate({ token, snapshot: original, etag: '"v1"', durationMs: 10 });

    const revalidateToken = randomUUID();
    await store.acquire({ token: revalidateToken, now: 61_000, ttlMs: 1, leaseMs: 60_000, force: true });
    await store.notModified({ token: revalidateToken, fetchedAt: 61_000, etag: '"v1"', durationMs: 15 });
    const state = await store.read();
    expect(state.snapshot).toMatchObject({ id: activeId, fetchedAt: 61_000, etag: '"v1"' });
    expect(state.snapshot!.entries).toHaveLength(1);
  });
});
