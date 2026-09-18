import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { issueSessionToken } from "../auth/session.js";
import { consumeRateLimit } from "../rateLimit.js";
import { validateBomCsv } from "./bomCsv.js";
import uploadsRouter from "./uploads.js";

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
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("openrouter.ai") && handlers.openrouter) return handlers.openrouter();
    if (href.includes("cdn.hackclub.com") && handlers.cdn) {
      cdnCalled = true;
      return handlers.cdn();
    }
    return realFetch(url as string, init);
  }) as typeof fetch;
  return {
    wasCdnCalled: () => cdnCalled,
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
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-rejected", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3, 4]),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("image_rejected");
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
    }
  });

  test("a moderation call that fails outright never reaches the CDN either", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({
      openrouter: () => Promise.reject(new Error("network down")),
      cdn: cdnSuccess,
    });
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-error", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3, 4]),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };

      expect(res.status).toBe(400);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("image_rejected");
      expect(mock.wasCdnCalled()).toBe(false);
    } finally {
      await app.close();
      mock.restore();
    }
  });

  test("a safe image does reach the CDN (control, proves the harness itself works)", async () => {
    process.env.HACKCLUB_CDN_KEY = "test-cdn-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const mock = mockExternalFetch({ openrouter: safeVerdict, cdn: cdnSuccess });
    const app = await startTestApp();
    try {
      const token = issueSessionToken({ userId: "upload-test-safe", displayName: "x" });
      const res = await fetch(`${app.baseUrl}/api/uploads?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([1, 2, 3, 4]),
      });
      const body = (await res.json()) as { ok: boolean; url?: string };

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.url).toBe("https://cdn.hackclub.com/fixture.png");
      expect(mock.wasCdnCalled()).toBe(true);
    } finally {
      await app.close();
      mock.restore();
    }
  });
});
