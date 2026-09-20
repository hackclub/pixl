import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { rateLimit } from "./rateLimit.js";

// Mirrors index.ts's trust proxy setting - these tests exercise the same
// header-precedence behavior the real app has, not a simplified stand-in.
async function startTestApp(max: number) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(rateLimit({ windowMs: 60_000, max, name: `test-${Date.now()}-${Math.random()}` }));
  app.get("/thing", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("rateLimit (Express middleware, CF-Connecting-IP precedence)", () => {
  test("the same client is limited across repeated requests", async () => {
    const { baseUrl, close } = await startTestApp(2);
    try {
      const headers = { "cf-connecting-ip": "203.0.113.1" };
      expect((await fetch(`${baseUrl}/thing`, { headers })).status).toBe(200);
      expect((await fetch(`${baseUrl}/thing`, { headers })).status).toBe(200);
      expect((await fetch(`${baseUrl}/thing`, { headers })).status).toBe(429);
    } finally {
      await close();
    }
  });

  test("two different CF-Connecting-IP values get separate buckets, even from the same connecting socket", async () => {
    const { baseUrl, close } = await startTestApp(1);
    try {
      const a = await fetch(`${baseUrl}/thing`, { headers: { "cf-connecting-ip": "203.0.113.1" } });
      const b = await fetch(`${baseUrl}/thing`, { headers: { "cf-connecting-ip": "203.0.113.2" } });
      // Both requests came from this same test process/socket - if the
      // bucket key were the raw connecting IP instead of CF-Connecting-IP,
      // the second request would already be over the max-1 limit.
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    } finally {
      await close();
    }
  });

  test("a client can't spoof a different identity via X-Forwarded-For once CF-Connecting-IP is set", async () => {
    const { baseUrl, close } = await startTestApp(1);
    try {
      const first = await fetch(`${baseUrl}/thing`, {
        headers: { "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "9.9.9.9" },
      });
      const second = await fetch(`${baseUrl}/thing`, {
        // Same real client (same CF-Connecting-IP), forged XFF changed -
        // must still hit the same bucket as the first request.
        headers: { "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "1.1.1.1" },
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
    } finally {
      await close();
    }
  });
});
