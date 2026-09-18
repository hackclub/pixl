import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { isRealImage } from "./imageValidation.js";

function pixel() {
  return { create: { width: 2, height: 2, channels: 3 as const, background: { r: 1, g: 2, b: 3 } } };
}

describe("isRealImage", () => {
  test("accepts a real PNG claiming image/png", async () => {
    const buf = await sharp(pixel()).png().toBuffer();
    expect(await isRealImage(buf, "image/png")).toBe(true);
  });

  test("accepts a real JPEG claiming image/jpeg", async () => {
    const buf = await sharp(pixel()).jpeg().toBuffer();
    expect(await isRealImage(buf, "image/jpeg")).toBe(true);
  });

  test("accepts a real WebP claiming image/webp", async () => {
    const buf = await sharp(pixel()).webp().toBuffer();
    expect(await isRealImage(buf, "image/webp")).toBe(true);
  });

  test("rejects random bytes claiming image/png", async () => {
    const buf = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await isRealImage(buf, "image/png")).toBe(false);
  });

  test("rejects a real image whose declared MIME doesn't match its actual bytes", async () => {
    const jpeg = await sharp(pixel()).jpeg().toBuffer();
    expect(await isRealImage(jpeg, "image/png")).toBe(false);

    const png = await sharp(pixel()).png().toBuffer();
    expect(await isRealImage(png, "image/webp")).toBe(false);
  });

  test("rejects a truncated PNG even though its header is intact", async () => {
    const full = await sharp(pixel()).png().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    expect(await isRealImage(truncated, "image/png")).toBe(false);
  });

  test("rejects a truncated JPEG even though its header is intact", async () => {
    const full = await sharp(pixel()).jpeg().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    expect(await isRealImage(truncated, "image/jpeg")).toBe(false);
  });

  test("rejects an unsupported declared MIME outright", async () => {
    const buf = await sharp(pixel()).png().toBuffer();
    expect(await isRealImage(buf, "image/gif")).toBe(false);
  });
});
