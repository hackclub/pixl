import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { db } from "./db/pgCompat.js";
import { activeBan, createBanStateCache, enforceActiveBans, lookupActiveBan, type BanState } from "./moderation.js";

// A signed, unexpired JWT only proves who someone was when it was issued -
// this proves a currently-banned user's still-valid token can no longer
// reach a state-changing route, regardless of what the route itself does.
// The real activeBan()/verifySessionToken() are swapped out via deps so this
// doesn't need a live "bans" table - see EnforceActiveBansDeps in moderation.ts.
async function startTestApp(banState: (userId: string) => Promise<BanState>) {
  const app = express();
  app.use(
    enforceActiveBans({
      banState,
      verify: (token) => (token === "valid-token" ? { userId: "u1", displayName: "Test" } : null),
    }),
  );
  app.post("/api/shop/buy/1", (_req, res) => res.json({ ok: true, bought: true }));
  app.get("/api/public/thing", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("enforceActiveBans", () => {
  test("a banned user's shop purchase is denied before the route runs", async () => {
    const { baseUrl, close } = await startTestApp(async () => "banned");
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: "banned" });
    } finally {
      await close();
    }
  });

  test("a not-banned user's shop purchase reaches the route normally", async () => {
    const { baseUrl, close } = await startTestApp(async () => "clear");
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, bought: true });
    } finally {
      await close();
    }
  });

  test("a request with no token is never blocked - public endpoints stay public", async () => {
    const { baseUrl, close } = await startTestApp(async () => "banned");
    try {
      const res = await fetch(`${baseUrl}/api/public/thing`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  test("an invalid/garbage token is left to the route's own auth check, not blocked here", async () => {
    const { baseUrl, close } = await startTestApp(async () => "banned");
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=garbage`, { method: "POST" });
      // the lookup always says banned in this test, so if the middleware were
      // (wrongly) treating an unverifiable token as some default identity,
      // this would be a 403 instead of falling through to the route.
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("enforceActiveBans when the ban lookup fails", () => {
  test("a state-changing request is refused with a retryable 503", async () => {
    const { baseUrl, close } = await startTestApp(async () => "unknown");
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      expect(await res.json()).toEqual({ ok: false, error: "ban_check_unavailable" });
    } finally {
      await close();
    }
  });

  test("a read-only request still goes through", async () => {
    const { baseUrl, close } = await startTestApp(async () => "unknown");
    try {
      const res = await fetch(`${baseUrl}/api/public/thing?token=valid-token`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  test("a lookup that throws is treated like a failed lookup", async () => {
    const { baseUrl, close } = await startTestApp(async () => {
      throw new Error("db down");
    });
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(503);
    } finally {
      await close();
    }
  });

  test("requests without a token are unaffected by lookup failures", async () => {
    const { baseUrl, close } = await startTestApp(async () => "unknown");
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1`, { method: "POST" });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("createBanStateCache", () => {
  function harness(results: BanState[]) {
    let calls = 0;
    let t = 0;
    const banState = createBanStateCache(
      async () => results[Math.min(calls++, results.length - 1)],
      30_000,
      () => t,
    );
    return { banState, calls: () => calls, advance: (ms: number) => (t += ms) };
  }

  test("a failed lookup does not populate a clean cache entry", async () => {
    const h = harness(["unknown", "banned"]);
    expect(await h.banState("u1")).toBe("unknown");
    expect(await h.banState("u1")).toBe("banned");
    expect(h.calls()).toBe(2);
  });

  test("a failed lookup after an error is retried rather than cached as clear", async () => {
    const h = harness(["unknown", "unknown", "clear"]);
    expect(await h.banState("u1")).toBe("unknown");
    expect(await h.banState("u1")).toBe("unknown");
    expect(await h.banState("u1")).toBe("clear");
    expect(h.calls()).toBe(3);
  });

  test("a stale banned verdict survives a failed refresh", async () => {
    const h = harness(["banned", "unknown"]);
    expect(await h.banState("u1")).toBe("banned");
    h.advance(31_000);
    expect(await h.banState("u1")).toBe("banned");
  });

  test("a stale clear verdict does not survive a failed refresh", async () => {
    const h = harness(["clear", "unknown"]);
    expect(await h.banState("u1")).toBe("clear");
    h.advance(31_000);
    expect(await h.banState("u1")).toBe("unknown");
  });

  test("successful verdicts are cached for the ttl and then refreshed", async () => {
    const h = harness(["clear", "banned"]);
    expect(await h.banState("u1")).toBe("clear");
    h.advance(29_000);
    expect(await h.banState("u1")).toBe("clear");
    expect(h.calls()).toBe(1);
    h.advance(2_000);
    expect(await h.banState("u1")).toBe("banned");
  });
});

describe("lookupActiveBan", () => {
  function mockBans(result: { data: unknown; error: unknown }) {
    const realFrom = db.from;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "or", "order", "limit"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    db.from = (() => chain) as unknown as typeof db.from;
    return () => {
      db.from = realFrom;
    };
  }

  test("a database error is reported as a failed lookup, not as no ban", async () => {
    const restore = mockBans({ data: null, error: { message: "connection refused" } });
    try {
      expect(await lookupActiveBan("u1")).toEqual({ ok: false });
      expect(await activeBan("u1")).toBeNull();
    } finally {
      restore();
    }
  });

  test("no rows is a successful lookup with no ban", async () => {
    const restore = mockBans({ data: [], error: null });
    try {
      expect(await lookupActiveBan("u1")).toEqual({ ok: true, ban: null });
    } finally {
      restore();
    }
  });

  test("a row is a successful lookup with the ban", async () => {
    const restore = mockBans({ data: [{ id: 1, user_id: "u1" }], error: null });
    try {
      const result = await lookupActiveBan("u1");
      expect(result.ok && result.ban?.id).toBe(1);
    } finally {
      restore();
    }
  });
});
