import sharp from "sharp";

const MIME_TO_FORMAT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

export type SanitizeResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; buffer?: undefined };

// Full decode + re-encode - catches truncation/format mismatches (a
// malformed or mismatched file throws or fails the format check) and, as a
// side effect, strips EXIF/ICC/XMP metadata: sharp only carries that through
// to its output when withMetadata() is explicitly called, which this never
// does. That matters because a phone-camera photo's EXIF commonly embeds GPS
// coordinates - every caller MUST upload the returned buffer, never the
// original bytes, or the metadata (and any location) survives untouched.
export async function sanitizeImage(buf: Buffer, mime: string): Promise<SanitizeResult> {
  const expected = MIME_TO_FORMAT[mime];
  if (!expected) return { ok: false };
  try {
    const { data, info } = await sharp(buf, { failOn: "error" }).toBuffer({ resolveWithObject: true });
    if (info.format !== expected) return { ok: false };
    return { ok: true, buffer: data };
  } catch {
    return { ok: false };
  }
}

// Boolean-only convenience wrapper, kept for callers that just need the
// validity check (see sanitizeImage above for the metadata-stripped bytes).
export async function isRealImage(buf: Buffer, mime: string): Promise<boolean> {
  return (await sanitizeImage(buf, mime)).ok;
}
