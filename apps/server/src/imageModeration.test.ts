import { afterEach, expect, test } from "bun:test";
import { checkImageSafe } from "./imageModeration.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalAllowUnmoderated = process.env.ALLOW_UNMODERATED_UPLOADS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalAllowUnmoderated === undefined) delete process.env.ALLOW_UNMODERATED_UPLOADS;
  else process.env.ALLOW_UNMODERATED_UPLOADS = originalAllowUnmoderated;
});

test("rejects an image when configured moderation is unavailable", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  const result = await checkImageSafe(Buffer.from("test"), "image/png");

  expect(result.safe).toBe(false);
});

test("rejects an image when the moderation call throws", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const result = await checkImageSafe(Buffer.from("test"), "image/png");

  expect(result.safe).toBe(false);
});

test("rejects an image when no key is set and dev opt-in isn't set (production default)", async () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ALLOW_UNMODERATED_UPLOADS;
  globalThis.fetch = async () => {
    throw new Error("should never be called without a key");
  };

  const result = await checkImageSafe(Buffer.from("test"), "image/png");

  expect(result.safe).toBe(false);
  expect(result.reason).toBe("moderation_unavailable");
});

test("allows an image when no key is set and dev opt-in is set", async () => {
  delete process.env.OPENROUTER_API_KEY;
  process.env.ALLOW_UNMODERATED_UPLOADS = "true";
  globalThis.fetch = async () => {
    throw new Error("should never be called without a key");
  };

  const result = await checkImageSafe(Buffer.from("test"), "image/png");

  expect(result.safe).toBe(true);
});

test("rejects an empty buffer even with a key configured", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () => {
    throw new Error("should never be called for an invalid buffer");
  };

  const result = await checkImageSafe(Buffer.alloc(0), "image/png");

  expect(result.safe).toBe(false);
  expect(result.reason).toBe("invalid_image");
});

test("rejects an image the model explicitly flags as unsafe", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"safe": false, "reason": "nudity"}' } }],
      }),
      { status: 200 },
    );

  const result = await checkImageSafe(Buffer.from("test"), "image/png");

  expect(result.safe).toBe(false);
  expect(result.reason).toBe("nudity");
});
