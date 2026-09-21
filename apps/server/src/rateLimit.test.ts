import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  RATE_LIMIT_MAX_BUCKETS,
  consumeRateLimit,
  peekRateLimit,
  rateLimit,
  rateLimitBucketCount,
  sweepRateLimitBuckets,
} from "./rateLimit.js";

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

describe("peekRateLimit", () => {
  const opts = { windowMs: 60_000, max: 2, name: "peek-test" };

  afterEach(() => setSystemTime());

  test("reads a bucket without consuming it", () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 50; i++) expect(peekRateLimit(opts, key)).toBeNull();
    expect(consumeRateLimit(opts, key)).toBeNull();
    expect(consumeRateLimit(opts, key)).toBeNull();
    expect(consumeRateLimit(opts, key)).not.toBeNull();
  });

  test("reports retry-after once max failures are recorded", () => {
    const key = `peek-full-${Math.random()}`;
    consumeRateLimit(opts, key);
    expect(peekRateLimit(opts, key)).toBeNull();
    consumeRateLimit(opts, key);
    expect(peekRateLimit(opts, key)).toBeGreaterThan(0);
  });

  test("a peek at an unseen key does not create a bucket", () => {
    const before = rateLimitBucketCount();
    peekRateLimit(opts, `never-seen-${Math.random()}`);
    expect(rateLimitBucketCount()).toBe(before);
  });

  test("the block lifts when the window expires", () => {
    const key = `peek-expire-${Math.random()}`;
    setSystemTime(new Date("2030-01-01T00:00:00Z"));
    consumeRateLimit(opts, key);
    consumeRateLimit(opts, key);
    expect(peekRateLimit(opts, key)).not.toBeNull();
    setSystemTime(new Date("2030-01-01T00:01:01Z"));
    expect(peekRateLimit(opts, key)).toBeNull();
  });
});

describe("bucket cleanup and bounds", () => {
  afterEach(() => setSystemTime());

  function clearAllBuckets() {
    setSystemTime(new Date("2040-01-01T00:00:00Z"));
    sweepRateLimitBuckets();
    setSystemTime();
  }

  test("expired buckets are swept and live ones are kept", () => {
    setSystemTime(new Date("2031-01-01T00:00:00Z"));
    sweepRateLimitBuckets();
    const base = rateLimitBucketCount();
    const short = { windowMs: 1_000, max: 5, name: "sweep-short" };
    const long = { windowMs: 600_000, max: 1, name: "sweep-long" };
    consumeRateLimit(short, "a");
    consumeRateLimit(long, "a");
    expect(rateLimitBucketCount()).toBe(base + 2);

    setSystemTime(new Date("2031-01-01T00:00:05Z"));
    sweepRateLimitBuckets();
    expect(rateLimitBucketCount()).toBe(base + 1);
    expect(peekRateLimit(long, "a")).toBeGreaterThan(0);

    setSystemTime(new Date("2031-01-01T00:20:00Z"));
    sweepRateLimitBuckets();
    expect(rateLimitBucketCount()).toBe(base);
  });

  test("a key flood never grows the map past its cap and evicts oldest first", () => {
    clearAllBuckets();
    const flood = { windowMs: 600_000, max: 1, name: "flood" };
    const total = RATE_LIMIT_MAX_BUCKETS + 5_000;
    for (let i = 0; i < total; i++) consumeRateLimit(flood, `k${i}`);
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(RATE_LIMIT_MAX_BUCKETS);
    expect(peekRateLimit(flood, "k0")).toBeNull();
    expect(peekRateLimit(flood, `k${total - 1}`)).toBeGreaterThan(0);
    clearAllBuckets();
  });
});
