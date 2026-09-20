import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { rateLimit } from "./rateLimit.js";

async function startTestApp(max: number) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(rateLimit({ windowMs: 60_000, max, name: `test-${Date.now()}-${Math.random()}` }));
  app.get("/thing", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const get = async (headers: Record<string, string> = {}) =>
    (await fetch(`http://127.0.0.1:${port}/thing`, { headers })).status;
  return {
    get,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const CF_PEER = "162.158.10.20";

describe("rateLimit (Express middleware, trusted client IP)", () => {
  test("the same client is limited across repeated requests", async () => {
    const { get, close } = await startTestApp(2);
    try {
      expect(await get()).toBe(200);
      expect(await get()).toBe(200);
      expect(await get()).toBe(429);
    } finally {
      await close();
    }
  });

  test("rotating a forged CF-Connecting-IP from a direct peer cannot select a fresh bucket", async () => {
    const { get, close } = await startTestApp(1);
    try {
      expect(await get({ "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "203.0.113.1" })).toBe(200);
      expect(await get({ "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "203.0.113.2" })).toBe(429);
      expect(await get({ "cf-connecting-ip": "203.0.113.3" })).toBe(200);
      expect(await get({ "cf-connecting-ip": "203.0.113.4" })).toBe(429);
      expect(await get({ "cf-connecting-ip": "aaaa" })).toBe(429);
    } finally {
      await close();
    }
  });

  test("rotating a spoofed X-Forwarded-For prefix cannot select a fresh bucket", async () => {
    const { get, close } = await startTestApp(1);
    try {
      expect(await get({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" })).toBe(200);
      expect(await get({ "x-forwarded-for": "2.2.2.2, 198.51.100.7" })).toBe(429);
      expect(await get({ "x-forwarded-for": `${CF_PEER}, 198.51.100.7`, "cf-connecting-ip": "203.0.113.9" })).toBe(429);
    } finally {
      await close();
    }
  });

  test("distinct ingress-observed peers keep separate buckets", async () => {
    const { get, close } = await startTestApp(1);
    try {
      expect(await get({ "x-forwarded-for": "198.51.100.1" })).toBe(200);
      expect(await get({ "x-forwarded-for": "198.51.100.2" })).toBe(200);
      expect(await get({ "x-forwarded-for": "198.51.100.1" })).toBe(429);
    } finally {
      await close();
    }
  });

  test("distinct IPv4-mapped IPv6 peers keep separate buckets", async () => {
    const { get, close } = await startTestApp(1);
    try {
      expect(await get({ "x-forwarded-for": "::ffff:1.2.3.4" })).toBe(200);
      expect(await get({ "x-forwarded-for": "::ffff:9.9.9.9" })).toBe(200);
      expect(await get({ "x-forwarded-for": "::ffff:1.2.3.4" })).toBe(429);
    } finally {
      await close();
    }
  });

  test("behind Cloudflare each real client gets its own bucket", async () => {
    const { get, close } = await startTestApp(1);
    try {
      expect(await get({ "x-forwarded-for": CF_PEER, "cf-connecting-ip": "203.0.113.1" })).toBe(200);
      expect(await get({ "x-forwarded-for": CF_PEER, "cf-connecting-ip": "203.0.113.2" })).toBe(200);
      expect(await get({ "x-forwarded-for": CF_PEER, "cf-connecting-ip": "203.0.113.1" })).toBe(429);
      expect(await get({ "x-forwarded-for": `9.9.9.9, ${CF_PEER}`, "cf-connecting-ip": "203.0.113.1" })).toBe(429);
    } finally {
      await close();
    }
  });
});
