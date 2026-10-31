import sharp from "sharp";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 4096 * 4096;

// Keep each output pixel in a pixelSize-wide block. Sharp only applies the
// final resize in a pipeline, so the downscale must finish before upscaling.
export async function pixelateAvatar(input: Buffer, pixelSize: number): Promise<Buffer> {
  if (input.length === 0 || input.length > MAX_AVATAR_BYTES) {
    throw new Error("Profile picture is missing or too large");
  }
  if (!Number.isSafeInteger(pixelSize) || pixelSize < 1 || pixelSize > 64) {
    throw new Error("Invalid pixel size");
  }

  const { width, height } = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS }).metadata();
  if (!width || !height) throw new Error("Profile picture has no dimensions");

  const reduced = await sharp(input, { limitInputPixels: MAX_AVATAR_PIXELS })
    .resize({
      width: Math.max(1, Math.floor(width / pixelSize)),
      height: Math.max(1, Math.floor(height / pixelSize)),
      kernel: "nearest",
      fit: "fill",
    })
    .toBuffer();

  return sharp(reduced)
    .resize({ width, height, kernel: "nearest", fit: "fill" })
    .png()
    .toBuffer();
}

// Slack supplies the avatar URL. Cap downloaded bytes before invoking the
// decoder, rather than buffering an arbitrarily large remote response.
export async function pixelateAvatarUrl(avatarUrl: string, pixelSize: number): Promise<Buffer> {
  const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error("Could not download profile picture");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_AVATAR_BYTES) {
        await reader.cancel();
        throw new Error("Profile picture is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return pixelateAvatar(Buffer.concat(chunks, bytes), pixelSize);
}
