import { afterEach, describe, expect, test } from "bun:test";
import { db } from "../db/pgCompat.js";
import { CDN_UPLOAD_QUOTA, reserveCdnUploadQuota, releaseCdnUploadQuota } from "./cdnQuota.js";

const realRpc = db.rpc;

afterEach(() => {
  db.rpc = realRpc;
});

function mockRpc(response: { data?: unknown; error?: { message: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  db.rpc = (async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    return { data: response.data ?? null, error: response.error ?? null };
  }) as typeof db.rpc;
  return calls;
}

describe("reserveCdnUploadQuota (RPC wiring)", () => {
  test("calls reserve_cdn_upload_quota with the right args and grants on ok:true", async () => {
    const calls = mockRpc({ data: { ok: true, window_id: 7 } });

    const result = await reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, "user-a", 12345);

    expect(result).toEqual({ ok: true, windowId: 7 });
    expect(calls).toEqual([
      {
        fn: "reserve_cdn_upload_quota",
        args: {
          p_user_id: "user-a",
          p_bytes: 12345,
          p_max_requests: CDN_UPLOAD_QUOTA.maxRequests,
          p_max_bytes: CDN_UPLOAD_QUOTA.maxBytes,
          p_window_seconds: Math.round(CDN_UPLOAD_QUOTA.windowMs / 1000),
        },
      },
    ]);
  });

  test("surfaces the DB's retry-after when the RPC says the budget is exhausted", async () => {
    mockRpc({ data: { ok: false, retry_after_seconds: 42 } });

    const result = await reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, "user-b", 1);

    expect(result).toEqual({ ok: false, reason: "quota_exceeded", retryAfterSeconds: 42 });
  });

  test("fails closed (does not grant) when the RPC errors", async () => {
    mockRpc({ error: { message: "connection refused" } });

    const result = await reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, "user-c", 1);

    expect(result).toEqual({ ok: false, reason: "quota_unavailable" });
  });

  test("fails closed when the RPC returns no data at all", async () => {
    mockRpc({ data: null, error: null });

    const result = await reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, "user-d", 1);

    expect(result).toEqual({ ok: false, reason: "quota_unavailable" });
  });
});

describe("releaseCdnUploadQuota (RPC wiring)", () => {
  test("calls release_cdn_upload_quota with the user, bytes, and the exact window id", async () => {
    const calls = mockRpc({ data: null, error: null });

    await releaseCdnUploadQuota("user-e", 500, 7);

    expect(calls).toEqual([
      {
        fn: "release_cdn_upload_quota",
        args: { p_user_id: "user-e", p_bytes: 500, p_window_id: 7 },
      },
    ]);
  });

  test("does not throw when the release RPC errors (best-effort)", async () => {
    mockRpc({ error: { message: "connection refused" } });

    await expect(releaseCdnUploadQuota("user-f", 500, 7)).resolves.toBeUndefined();
  });
});

// real Postgres, skipped without DATABASE_URL
describe.skipIf(!process.env.DATABASE_URL)("reserveCdnUploadQuota (real Postgres)", () => {
  async function uid(): Promise<string> {
    const { data } = await db
      .from("users")
      .insert({ oauth_provider: "test", oauth_id: crypto.randomUUID(), display_name: "test" })
      .select("id")
      .single();
    return (data as { id: string }).id;
  }

  test("grants requests under both caps, denies once either is exceeded", async () => {
    const opts = { windowMs: 60_000, maxRequests: 2, maxBytes: 1000 };
    const user = await uid();
    expect((await reserveCdnUploadQuota(opts, user, 100)).ok).toBe(true);
    expect((await reserveCdnUploadQuota(opts, user, 100)).ok).toBe(true);
    const third = await reserveCdnUploadQuota(opts, user, 100);
    expect(third.ok).toBe(false);
  });

  test("denies once the byte cap is hit, even under the request cap", async () => {
    const opts = { windowMs: 60_000, maxRequests: 1000, maxBytes: 500 };
    const user = await uid();
    expect((await reserveCdnUploadQuota(opts, user, 400)).ok).toBe(true);
    const second = await reserveCdnUploadQuota(opts, user, 200);
    expect(second.ok).toBe(false);
  });

  test("one user's usage never counts against another user's quota", async () => {
    const opts = { windowMs: 60_000, maxRequests: 1, maxBytes: 1_000_000 };
    expect((await reserveCdnUploadQuota(opts, await uid(), 1)).ok).toBe(true);
    expect((await reserveCdnUploadQuota(opts, await uid(), 1)).ok).toBe(true);
  });

  test("releasing a reservation with its own window id frees both budgets back up", async () => {
    const opts = { windowMs: 60_000, maxRequests: 1, maxBytes: 100 };
    const user = await uid();
    const first = await reserveCdnUploadQuota(opts, user, 100);
    expect(first.ok).toBe(true);
    expect((await reserveCdnUploadQuota(opts, user, 100)).ok).toBe(false);

    if (first.ok) await releaseCdnUploadQuota(user, 100, first.windowId);

    expect((await reserveCdnUploadQuota(opts, user, 100)).ok).toBe(true);
  });

  test("the window resets after windowMs elapses", async () => {
    const opts = { windowMs: 1, maxRequests: 1, maxBytes: 1_000_000 };
    const user = await uid();
    expect((await reserveCdnUploadQuota(opts, user, 1)).ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await reserveCdnUploadQuota(opts, user, 1)).ok).toBe(true);
  });

  // The window-boundary bug this migration fixes: a release that arrives
  // after its window has already rolled over must never decrement the NEW
  // window's usage - that would let a caller free up budget a live
  // reservation is still holding. Backdates window_resets_at directly
  // instead of sleeping past a short window, so the rollover is exact and
  // the test isn't racing its own real-time window.
  test("a release against a rolled-over window never frees a newer window's budget", async () => {
    const opts = { windowMs: 60_000, maxRequests: 1, maxBytes: 1_000_000 };
    const user = await uid();

    const first = await reserveCdnUploadQuota(opts, user, 1);
    expect(first.ok).toBe(true);

    await db
      .from("cdn_upload_quota")
      .update({ window_resets_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", user);

    // Take the one slot in the new window.
    const second = await reserveCdnUploadQuota(opts, user, 1);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.windowId).not.toBe(first.windowId);

    // A late release for the first (now stale) reservation must not touch
    // the second window's live usage.
    await releaseCdnUploadQuota(user, 1, first.windowId);

    const third = await reserveCdnUploadQuota(opts, user, 1);
    expect(third.ok).toBe(false);
  });

  // the atomicity proof: must grant exactly 10, never more
  test("concurrent reservations against a shared budget never oversell it", async () => {
    const opts = { windowMs: 60_000, maxRequests: 10, maxBytes: 1_000_000 };
    const user = await uid();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => reserveCdnUploadQuota(opts, user, 1)),
    );

    const granted = results.filter((r) => r.ok).length;
    expect(granted).toBe(10);
  });
});
