import { describe, expect, test } from "bun:test";
import { buildSnapshot, createPersistentShipsProvider } from "./ships";
import type { ShipsSnapshotStore, StoredShipsSnapshot, StoredShipsState } from "./shipsSnapshotStore";

const record = (id = "recAAAAAAAAAAAAAA", ysws = "PIXL", over: Record<string, unknown> = {}) => ({
  id,
  ysws,
  approved_at: 1_790_000_000,
  code_url: `https://github.com/example/${id}`,
  github_username: "example",
  hours: 4,
  slack_id: "U123456",
  display_name: "must not be persisted",
  ...over,
});

const asStored = (snapshot: ReturnType<typeof buildSnapshot>, id = "00000000-0000-4000-8000-000000000001"): StoredShipsSnapshot => ({
  id,
  fetchedAt: snapshot.fetchedAt,
  etag: null,
  entries: [...snapshot.byId.values()],
  invalidIds: [...snapshot.invalidIds],
  ambiguousIds: [...snapshot.ambiguousIds],
  totalReturned: snapshot.totalReturned,
  pixlCount: snapshot.pixlCount,
  invalidCount: snapshot.invalidCount,
  duplicateCount: snapshot.duplicateCount,
  bytes: snapshot.bytes,
});

function memoryStore(initial: Partial<StoredShipsState> = {}) {
  let state: StoredShipsState = {
    snapshot: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    error: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
    lastDurationMs: null,
    refreshing: false,
    ...initial,
  };
  let lock: string | null = null;
  const store: ShipsSnapshotStore = {
    read: async () => state,
    acquire: async (input) => {
      if (lock) return { acquired: false, reason: "busy" };
      if (!input.force && state.nextRetryAt != null && state.nextRetryAt > input.now) return { acquired: false, reason: "backoff" };
      if (!input.force && state.snapshot && state.snapshot.fetchedAt > input.now - input.ttlMs)
        return { acquired: false, reason: "fresh" };
      lock = input.token;
      state = { ...state, lastAttemptAt: input.now, refreshing: true };
      return { acquired: true };
    },
    activate: async (input) => {
      if (lock !== input.token) throw new Error("lost lease");
      state = {
        ...state,
        snapshot: asStored(input.snapshot, "00000000-0000-4000-8000-000000000002"),
        lastSuccessAt: input.snapshot.fetchedAt,
        error: null,
        consecutiveFailures: 0,
        nextRetryAt: null,
        lastDurationMs: input.durationMs,
        refreshing: false,
      };
      state.snapshot.etag = input.etag;
      lock = null;
      return state.snapshot.id;
    },
    notModified: async (input) => {
      if (lock !== input.token || !state.snapshot) throw new Error("lost lease");
      state = {
        ...state,
        snapshot: { ...state.snapshot, fetchedAt: input.fetchedAt, etag: input.etag ?? state.snapshot.etag },
        lastSuccessAt: input.fetchedAt,
        error: null,
        consecutiveFailures: 0,
        nextRetryAt: null,
        lastDurationMs: input.durationMs,
        refreshing: false,
      };
      lock = null;
    },
    fail: async (input) => {
      if (lock !== input.token) return null;
      const nextRetryAt = input.now + 30_000;
      state = {
        ...state,
        error: input.error,
        consecutiveFailures: state.consecutiveFailures + 1,
        nextRetryAt,
        lastDurationMs: input.durationMs,
        refreshing: false,
      };
      lock = null;
      return { nextRetryAt };
    },
  };
  return { store, state: () => state };
}

describe("persistent Ships provider", () => {
  test("fulfillment reads the active database snapshot without calling Ships", async () => {
    const snapshot = buildSnapshot([record()], 1_800_000_000_000 - 1000, 100);
    const fake = memoryStore({ snapshot: asStored(snapshot), lastSuccessAt: snapshot.fetchedAt });
    let calls = 0;
    const provider = createPersistentShipsProvider({
      store: fake.store,
      now: () => 1_800_000_000_000,
      fetchImpl: (async () => {
        calls++;
        return new Response("should not be fetched");
      }) as typeof fetch,
    });

    const view = await provider.get();
    expect(calls).toBe(0);
    expect(view.snapshot!.byId.has("recAAAAAAAAAAAAAA")).toBe(true);
    expect(view.fresh).toBe(true);
  });

  test("a complete response activates only validated PIXL rows", async () => {
    const fake = memoryStore();
    let request: RequestInit | undefined;
    const provider = createPersistentShipsProvider({
      store: fake.store,
      now: () => 1_800_000_000_000,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        request = init;
        return new Response(JSON.stringify([record(), record("recBBBBBBBBBBBBBB", "Hardwire")]), {
          status: 200,
          headers: { etag: '"ships-v1"', "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const result = await provider.refreshDetailed(true);
    expect(result.outcome).toBe("refreshed");
    expect(request?.method).toBe("GET");
    expect(request?.body).toBeUndefined();
    expect(request?.redirect).toBe("error");
    expect((request?.headers as Record<string, string>).Accept).toBe("application/json");
    expect(fake.state().snapshot!.pixlCount).toBe(1);
    expect(fake.state().snapshot!.entries).toHaveLength(1);
    expect(fake.state().snapshot!.etag).toBe('"ships-v1"');
    expect(Object.keys(fake.state().snapshot!.entries[0]!).sort()).not.toContain("display_name");
  });

  test("an invalid response keeps the active generation and persists the failure", async () => {
    const original = buildSnapshot([record()], 1_000, 100);
    const fake = memoryStore({ snapshot: asStored(original), lastSuccessAt: 1_000 });
    const provider = createPersistentShipsProvider({
      store: fake.store,
      now: () => 2_000,
      fetchImpl: (async () => new Response("[]", { status: 200 })) as typeof fetch,
    });

    const result = await provider.refreshDetailed(true);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("empty");
    expect(fake.state().snapshot!.fetchedAt).toBe(1_000);
    expect(fake.state().lastSuccessAt).toBe(1_000);
    expect(fake.state().error).toContain("empty");
    expect(fake.state().nextRetryAt).toBe(32_000);
  });

  test("a persistent retry window skips external fetches", async () => {
    const fake = memoryStore({ error: "last failure", nextRetryAt: 31_000 });
    let calls = 0;
    const provider = createPersistentShipsProvider({
      store: fake.store,
      now: () => 2_000,
      fetchImpl: (async () => {
        calls++;
        return new Response("[]");
      }) as typeof fetch,
    });

    const result = await provider.refreshDetailed(false);
    expect(result.outcome).toBe("skipped_backoff");
    expect(result.error).toBe("last failure");
    expect(calls).toBe(0);
  });
});
