import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import jwt from "jsonwebtoken";
import type { RevocationReader } from "./revocation.js";

process.env.JWT_SECRET ??= "revocation-unit-test-secret";
const secret = process.env.JWT_SECRET;
const { issueSessionToken, verifySessionToken } = await import("./session.js");
const { createRevocationCache, enforceSessionRevocation, isSessionRevoked } = await import("./revocation.js");

const T0 = Date.parse("2030-03-01T12:00:00Z");
const SEC = 1000;

function issueAt(userId: string, ms: number): string {
  setSystemTime(new Date(ms));
  try {
    return issueSessionToken({ userId, displayName: "tester" });
  } finally {
    setSystemTime();
  }
}

function fakeDb() {
  const revokedAt = new Map<string, number>();
  const state = { lookups: 0, failing: false };
  return {
    state,
    revoke: (userId: string, ms: number) => void revokedAt.set(userId, ms),
    lookup: async (userId: string) => {
      state.lookups++;
      if (state.failing) return { ok: false as const };
      return { ok: true as const, revokedAtMs: revokedAt.get(userId) ?? null };
    },
  };
}

async function startApp(revokedAt: RevocationReader) {
  const hits = { count: 0 };
  const app = express();
  app.use(enforceSessionRevocation({ revokedAt }));
  app.get("/thing", (_req, res) => {
    hits.count++;
    res.json({ ok: true });
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const call = async (token?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/thing${token ? `?token=${token}` : ""}`);
    return { status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.json() };
  };
  return { call, hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

afterEach(() => setSystemTime());

describe("isSessionRevoked", () => {
  test("never revoked is never rejected", () => {
    expect(isSessionRevoked({ iat: 1 }, null)).toBe(false);
  });

  test("tokens issued before the revocation are rejected", () => {
    expect(isSessionRevoked({ iat: 100 }, 200 * SEC)).toBe(true);
  });

  test("a token from the same second as the revocation is rejected, never guessed valid", () => {
    expect(isSessionRevoked({ iat: 200 }, 200 * SEC)).toBe(true);
    expect(isSessionRevoked({ iat: 200 }, 200 * SEC + 900)).toBe(true);
  });

  test("tokens issued after the revocation second are accepted", () => {
    expect(isSessionRevoked({ iat: 201 }, 200 * SEC + 900)).toBe(false);
  });

  test("a token with no usable iat counts as the oldest possible", () => {
    expect(isSessionRevoked({ iat: 0 }, 5 * SEC)).toBe(true);
  });
});

describe("verifySessionToken", () => {
  test("returns the identity and the issue second", () => {
    const session = verifySessionToken(issueAt("user-1", T0));
    expect(session).toEqual({ userId: "user-1", displayName: "tester", iat: T0 / SEC });
  });

  test("rejects a token signed with another secret", () => {
    const forged = jwt.sign({ userId: "user-1", displayName: "x" }, "some-other-secret");
    expect(verifySessionToken(forged)).toBeNull();
  });

  test("rejects a validly signed token that is not a session token", () => {
    expect(verifySessionToken(jwt.sign({ sub: "user-1" }, secret))).toBeNull();
    expect(verifySessionToken(jwt.sign({ userId: 7, displayName: "x" }, secret))).toBeNull();
  });

  test("rejects an expired token", () => {
    const old = issueAt("user-1", Date.now() - 15 * 24 * 3600 * SEC);
    expect(verifySessionToken(old)).toBeNull();
  });
});

describe("createRevocationCache", () => {
  test("serves repeat lookups from cache until the ttl passes", async () => {
    const db = fakeDb();
    let now = 0;
    const cache = createRevocationCache(db.lookup, 10_000, () => now);
    await cache.get("u1");
    await cache.get("u1");
    now = 9_999;
    await cache.get("u1");
    expect(db.state.lookups).toBe(1);
    now = 10_000;
    await cache.get("u1");
    expect(db.state.lookups).toBe(2);
  });

  test("a revocation is picked up once the ttl passes", async () => {
    const db = fakeDb();
    let now = 0;
    const cache = createRevocationCache(db.lookup, 10_000, () => now);
    expect(await cache.get("u1")).toEqual({ ok: true, revokedAtMs: null });
    db.revoke("u1", 5 * SEC);
    expect(await cache.get("u1")).toEqual({ ok: true, revokedAtMs: null });
    now = 10_000;
    expect(await cache.get("u1")).toEqual({ ok: true, revokedAtMs: 5 * SEC });
  });

  test("forget makes the next read hit the database", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    await cache.get("u1");
    db.revoke("u1", 5 * SEC);
    cache.forget("u1");
    expect(await cache.get("u1")).toEqual({ ok: true, revokedAtMs: 5 * SEC });
  });

  test("a failed lookup is reported and not cached", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    db.state.failing = true;
    expect(await cache.get("u1")).toEqual({ ok: false });
    db.state.failing = false;
    expect(await cache.get("u1")).toEqual({ ok: true, revokedAtMs: null });
  });

  test("a thrown lookup is reported as a failure", async () => {
    const cache = createRevocationCache(async () => {
      throw new Error("boom");
    });
    expect(await cache.get("u1")).toEqual({ ok: false });
  });

  test("the cache stays bounded", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0, 5);
    for (let i = 0; i < 50; i++) await cache.get(`user-${i}`);
    expect(cache.size()).toBeLessThanOrEqual(5);
  });
});

describe("enforceSessionRevocation", () => {
  test("a token is accepted before revocation and rejected after, without reaching the route", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    const app = await startApp(cache.get);
    try {
      const token = issueAt("victim", T0);
      expect((await app.call(token)).status).toBe(200);
      expect(app.hits.count).toBe(1);

      db.revoke("victim", T0 + 60 * SEC);
      cache.forget("victim");

      const after = await app.call(token);
      expect(after.status).toBe(401);
      expect(after.body).toEqual({ ok: false, error: "session_revoked" });
      expect(app.hits.count).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("a token issued after the revocation works, an older sibling does not", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    const app = await startApp(cache.get);
    try {
      const leaked = issueAt("victim", T0);
      const sameSecond = issueAt("victim", T0 + 60 * SEC + 200);
      db.revoke("victim", T0 + 60 * SEC + 500);
      const relogin = issueAt("victim", T0 + 62 * SEC);

      expect((await app.call(leaked)).status).toBe(401);
      expect((await app.call(sameSecond)).status).toBe(401);
      expect((await app.call(relogin)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  test("another user's session is untouched", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    const app = await startApp(cache.get);
    try {
      const victim = issueAt("victim", T0);
      const bystander = issueAt("bystander", T0);
      db.revoke("victim", T0 + 60 * SEC);
      expect((await app.call(victim)).status).toBe(401);
      expect((await app.call(bystander)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  test("requests with no token or a bad token are left to the route's own auth", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    const app = await startApp(cache.get);
    try {
      expect((await app.call()).status).toBe(200);
      expect((await app.call("not-a-jwt")).status).toBe(200);
      expect(db.state.lookups).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("when revocation state cannot be read the request is refused, not waved through", async () => {
    const db = fakeDb();
    const cache = createRevocationCache(db.lookup, 10_000, () => 0);
    const app = await startApp(cache.get);
    try {
      const token = issueAt("victim", T0);
      db.state.failing = true;
      const down = await app.call(token);
      expect(down.status).toBe(503);
      expect(down.retryAfter).toBe("5");
      expect(app.hits.count).toBe(0);

      db.state.failing = false;
      expect((await app.call(token)).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  test("a lookup that throws is refused the same way", async () => {
    const app = await startApp(async () => {
      throw new Error("boom");
    });
    try {
      expect((await app.call(issueAt("victim", T0))).status).toBe(503);
    } finally {
      await app.close();
    }
  });
});
