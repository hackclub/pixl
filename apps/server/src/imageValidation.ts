import sharp from "sharp";

const MIME_TO_FORMAT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

// full decode, catches truncation too
export async function isRealImage(buf: Buffer, mime: string): Promise<boolean> {
  const expected = MIME_TO_FORMAT[mime];
  if (!expected) return false;
  try {
    const { info } = await sharp(buf, { failOn: "error" }).toBuffer({ resolveWithObject: true });
    return info.format === expected;
  } catch {
    return false;
  }
}
