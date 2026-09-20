import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { enforceActiveBans } from "./moderation.js";

// A signed, unexpired JWT only proves who someone was when it was issued -
// this proves a currently-banned user's still-valid token can no longer
// reach a state-changing route, regardless of what the route itself does.
// The real activeBan()/verifySessionToken() are swapped out via deps so this
// doesn't need a live "bans" table - see EnforceActiveBansDeps in moderation.ts.
async function startTestApp(isBanned: (userId: string) => Promise<boolean>) {
  const app = express();
  app.use(
    enforceActiveBans({
      isBanned,
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
    const { baseUrl, close } = await startTestApp(async () => true);
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: "banned" });
    } finally {
      await close();
    }
  });

  test("a not-banned user's shop purchase reaches the route normally", async () => {
    const { baseUrl, close } = await startTestApp(async () => false);
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=valid-token`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, bought: true });
    } finally {
      await close();
    }
  });

  test("a request with no token is never blocked - public endpoints stay public", async () => {
    const { baseUrl, close } = await startTestApp(async () => true);
    try {
      const res = await fetch(`${baseUrl}/api/public/thing`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  test("an invalid/garbage token is left to the route's own auth check, not blocked here", async () => {
    const { baseUrl, close } = await startTestApp(async () => true);
    try {
      const res = await fetch(`${baseUrl}/api/shop/buy/1?token=garbage`, { method: "POST" });
      // isBanned always returns true in this test, so if the middleware were
      // (wrongly) treating an unverifiable token as some default identity,
      // this would be a 403 instead of falling through to the route.
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
