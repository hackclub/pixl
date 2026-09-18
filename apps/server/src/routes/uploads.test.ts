import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import sharp from "sharp";
import { issueSessionToken } from "../auth/session.js";
import { db } from "../db/pgCompat.js";
import { consumeRateLimit } from "../rateLimit.js";
import { validateBomCsv, sanitizeBomCsv } from "./bomCsv.js";
import uploadsRouter from "./uploads.js";

const realPngBytes = () =>
  sharp({ create: { width: 2, height: 2, channels: 3 as const, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();

test("accepts a structured BOM CSV", () => {
  const result = validateBomCsv(Buffer.from("Part,Quantity\nResistor,4\n"));

  expect(result).toEqual({ ok: true });
});

test("rejects binary data masquerading as a CSV", () => {
  const result = validateBomCsv(Buffer.from([0x50, 0x61, 0x72, 0x74, 0, 0x31]));

  expect(result).toEqual({ ok: false, error: "invalid_csv" });
});

test("rejects unstructured CSV data", () => {
  const result = validateBomCsv(Buffer.from("this is not a bill of materials\n"));

  expect(result).toEqual({ ok: false, error: "invalid_csv" });
});

test("limits one authenticated account without limiting another", () => {
  const limit = { windowMs: 60_000, max: 1, name: `bom-test-${Date.now()}` };

  expect(consumeRateLimit(limit, "owner-a")).toBeNull();
  expect(consumeRateLimit(limit, "owner-a")).toBeGreaterThan(0);
  expect(consumeRateLimit(limit, "owner-b")).toBeNull();
});

test("neutralizes a formula-injection cell a reviewer would open in Excel/Sheets", () => {
  const csv = Buffer.from("Part,Quantity\n=1+1*99,4\n");

  const result = sanitizeBomCsv(csv);

  expect(result.toString("utf-8")).toBe("Part,Quantity\r\n'=1+1*99,4");
});

test("every formula-triggering prefix gets neutralized", () => {
  for (const prefix of ["=", "+", "-", "@"]) {
    const csv = Buffer.from(`Part,Quantity\n${prefix}cmd,4\n`);
    const rows = sanitizeBomCsv(csv).toString("utf-8").split("\r\n");
    expect(rows[1]).toBe(`'${prefix}cmd,4`);
  }
});

test("ordinary BOM data round-trips unchanged", () => {
  const csv = Buffer.from("Part,Quantity,Notes\nResistor 10k,4,5% tolerance\n");

  const result = sanitizeBomCsv(csv);

  expect(result.toString("utf-8")).toBe("Part,Quantity,Notes\r\nResistor 10k,4,5% tolerance");
});

test("a cell needing quoting still round-trips its value", () => {
  const csv = Buffer.from('Part,Notes\nResistor,"has, a comma"\n');

  const result = sanitizeBomCsv(csv);

  expect(result.toString("utf-8")).toBe('Part,Notes\r\nResistor,"has, a comma"');
});

async function startTestApp() {
  const app = express();
  app.use(uploadsRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function mockExternalFetch(handlers: {
  openrouter?: () => Promise<Response>;
  cdn?: () => Promise<Response>;
}) {
  const realFetch = globalThis.fetch;
  let cdnCalled = false;
  let openrouterCalled = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("openrouter.ai") && handlers.openrouter) {
      openrouterCalled = true;
      return handlers.openrouter();
    }
    if (href.includes("cdn.hackclub.com") && handlers.cdn) {
      cdnCalled = true;
      return handlers.cdn();
    }
    return realFetch(url as string, init);
  }) as typeof fetch;
  return {
    wasCdnCalled: () => cdnCalled,
    wasOpenRouterCalled: () => openrouterCalled,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

const safeVerdict = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"safe": true}' } }] }),
      { status: 200 },
    ),
  );

const unsafeVerdict = () =>
  Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"safe": false, "reason": "nudity"}' } }] }),
      { status: 200 },
    ),
  );

const cdnSuccess = () =>
  Promise.resolve(
    new Response(JSON.stringify({ url: "https://cdn.hackclub.com/fixture.png" }), { status: 200 }),
  );

// quota lives in Postgres now, see cdnQuota.test.ts
function mockQuotaRpc(mode: "grant" | "deny") {
  const realRpc = db.rpc;
  db.rpc = (async (fn: string) => {
    if (fn === "reserve_cdn_upload_quota") {
      return mode === "grant"
        ? { data: { ok: true }, error: null }
        : { data: { ok: false, retry_after_seconds: 60 }, error: null };
    }
    return { data: null, error: null };
  }) as typeof db.rpc;
  return {
    restore: () => {
      db.rpc = realRpc;
    },
  };
}

describe("POST /api/uploads", () => {
  const originalCdnKey = process.env.HACKCLUB_CDN_KEY;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (originalCdnKey === undefined) delete process.env.HACKCLUB_CDN_KEY;
    else process.env.HACKCLUB_CDN_KEY = originalCdnKey;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  });

  test("a rejected image never reaches the CDN", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: unsafeVerdict, cdn: cdnSuccess });
    const quota = mockQuotaRpc("grant");
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-rejected", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await realPngBytes(),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("image_rejected");
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
      quota.restore();
    }
  });

  test("a moderation call that fails outright never reaches the CDN either", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({
      openrouter: () => Promise.reject(new Error("network down")),
      cdn: cdnSuccess,
    });
    const quota = mockQuotaRpc("grant");
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-error", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await realPngBytes(),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("image_rejected");
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
      quota.restore();
    }
  });

  test("a safe image does reach the CDN (control, proves the harness itself works)", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: safeVerdict, cdn: cdnSuccess });
    const quota = mockQuotaRpc("grant");
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-safe", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await realPngBytes(),
      });
      const body = (await res.json()) as { ok: boolean; url?: string };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.url).toBe("https://cdn.hackclub.com/fixture.png");
      expect(mock.wasCdnCalled()).toBe(true);
    } finally {
      await app.close();
      mock.restore();
      quota.restore();
    }
  });

  test("random bytes claiming to be a PNG are rejected before moderation or the CDN", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: safeVerdict, cdn: cdnSuccess });
    const quota = mockQuotaRpc("grant");
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-fake-bytes", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_image");
      expect(mock.wasOpenRouterCalled()).toBe(false);
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
      quota.restore();
    }
  });

  test("an exhausted CDN quota blocks the upload before moderation or the CDN call", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: safeVerdict, cdn: cdnSuccess });
    const quota = mockQuotaRpc("deny");
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-quota", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await realPngBytes(),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(429);
      expect(body.error).toBe("quota_exceeded");
      expect(mock.wasOpenRouterCalled()).toBe(false);
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
      quota.restore();
    }
  });

  test("a quota check that errors fails closed instead of allowing the upload", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: safeVerdict, cdn: cdnSuccess });
    const realRpc = db.rpc;
    db.rpc = (async () => ({ data: null, error: { message: "connection refused" } })) as typeof db.rpc;
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-quota-error", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: await realPngBytes(),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(503);
      expect(body.error).toBe("quota_unavailable");
      expect(mock.wasOpenRouterCalled()).toBe(false);
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
      db.rpc = realRpc;
    }
  });
});
