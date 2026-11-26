import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { pixelateAvatar } from "./image";

describe("pixelateAvatar", () => {
  test("keeps the original dimensions and emits a PNG with nearest-neighbor blocks", async () => {
    const width = 8;
    const height = 8;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 3;
        pixels[index] = x * 30;
        pixels[index + 1] = y * 30;
        pixels[index + 2] = 100;
      }
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const output = await pixelateAvatar(input, 2);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width, height, channels: 3, format: "raw" });

    const sample = (x: number, y: number) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
    expect(sample(0, 0)).toEqual(sample(1, 1));
    expect(sample(2, 0)).toEqual(sample(3, 1));
    expect(sample(0, 0)).not.toEqual(sample(2, 0));
    expect((await sharp(output).metadata()).format).toBe("png");
  });

  test("rejects empty and oversized inputs and invalid block sizes", async () => {
    await expect(pixelateAvatar(Buffer.alloc(0), 8)).rejects.toThrow();
    await expect(pixelateAvatar(Buffer.alloc(5 * 1024 * 1024 + 1), 8)).rejects.toThrow();
    await expect(pixelateAvatar(Buffer.from("not an image"), 0)).rejects.toThrow();
  });
});
