import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
const adminUrl = process.env.PIXL_TEST_DATABASE_URL;
const suite = adminUrl ? describe : describe.skip;
suite("Airbridge cache migration", () => {
  const name = "pixl_airbridge_" + randomBytes(4).toString("hex");
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  const id = "recAAAAAAAAAAAAAA", unified = "recBBBBBBBBBBBBBB";
  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const url = new URL(adminUrl!);
    url.pathname = "/" + name;
    const migrator = postgres(url.toString(), { max: 1, onnotice: () => {} });
    await migrator.unsafe(readFileSync(
      join(import.meta.dir, "../../../server/drizzle/0236_fulfillment_unified_cache.sql"), "utf8"));
    await migrator.end();
    db = postgres(url.toString(), { max: 3, onnotice: () => {} });
  });
  afterAll(async () => {
    await db?.end();
    await admin.unsafe("drop database " + name + " with (force)");
    await admin.end();
  });
  test("records approval, correction, removal, but not timestamp-only refresh", async () => {
    await db`insert into fulfillment_unified_cache
      (staging_id, mapping_state, unified_id, unified_state, code_url,
       approved_hours, approved_at_s, mapping_checked_ms, verified_at_ms)
      values (${id}, 'mapped', ${unified}, 'approved',
       'https://github.com/org/project', 10.5, 1793448000, 100, 100)`;
    let rows = await db`select before_state, after_state from fulfillment_unified_changes
      where staging_id = ${id} order by id`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before_state).toBeNull();
    expect(Number(rows[0]!.after_state.hours)).toBe(10.5);
    await db`update fulfillment_unified_cache set mapping_checked_ms = 200,
      verified_at_ms = 200 where staging_id = ${id}`;
    expect(await db`select id from fulfillment_unified_changes where staging_id = ${id}`).toHaveLength(1);
    await db`update fulfillment_unified_cache set approved_hours = 7.2 where staging_id = ${id}`;
    await db`update fulfillment_unified_cache set unified_state = 'missing',
      code_url = null, approved_hours = null, approved_at_s = null where staging_id = ${id}`;
    rows = await db`select before_state, after_state from fulfillment_unified_changes
      where staging_id = ${id} order by id`;
    expect(rows).toHaveLength(3);
    expect(Number(rows[1]!.before_state.hours)).toBe(10.5);
    expect(Number(rows[1]!.after_state.hours)).toBe(7.2);
    expect(rows[2]!.before_state.state).toBe("approved");
    expect(rows[2]!.after_state.state).toBe("missing");
  });
  test("failed rows can move behind unattempted records without freshening evidence", async () => {
    const failed = "recDDDDDDDDDDDDDD", next = "recEEEEEEEEEEEEEE";
    await db`insert into fulfillment_unified_cache
      (staging_id, mapping_state, unified_state, last_attempt_ms)
      values (${failed}, 'error', 'error', 300), (${next}, 'error', 'error', 0)`;
    const ordered = await db`select staging_id, verified_at_ms from fulfillment_unified_cache
      where staging_id in (${failed}, ${next}) order by last_attempt_ms, staging_id`;
    expect(ordered.map(r => r.staging_id)).toEqual([next, failed]);
    expect(ordered.every(r => Number(r.verified_at_ms) === 0)).toBe(true);
  });
  test("refresh lease admits only one holder", async () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const acquire = (token: string) => db`update fulfillment_unified_sync_lease
      set token = ${token}::uuid, lease_until_ms = 2000
      where id = 1 and lease_until_ms < 1000 returning token`;
    expect(await acquire(a)).toHaveLength(1);
    expect(await acquire(b)).toHaveLength(0);
    await db`update fulfillment_unified_sync_lease set lease_until_ms = 0 where token = ${a}::uuid`;
    expect(await acquire(b)).toHaveLength(1);
  });
});
