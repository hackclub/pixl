// Minimal RGB PNG encoder (+ a decoder for compositing product photos into
// shop item cards). The cards are mostly rectangles and bitmap glyphs, so
// this beats pulling in sharp/resvg/satori and making them build on every
// host - the decoder only needs to handle whatever comes back from item
// image_urls, which are always 8-bit, non-interlaced PNGs in practice.
import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ bytes[i]!) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hex(color: string): Rgb {
  const n = parseInt(color.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly px: Uint8Array;

  constructor(width: number, height: number, fill: Rgb) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height * 3);
    this.fill(0, 0, width, height, fill);
  }

  fill(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      let i = (py * this.width + x0) * 3;
      for (let px = x0; px < x1; px++) {
        this.px[i++] = color.r;
        this.px[i++] = color.g;
        this.px[i++] = color.b;
      }
    }
  }

  stroke(x: number, y: number, w: number, h: number, weight: number, color: Rgb): void {
    this.fill(x, y, w, weight, color);
    this.fill(x, y + h - weight, w, weight, color);
    this.fill(x, y, weight, h, color);
    this.fill(x + w - weight, y, weight, h, color);
  }

  // Blits a decoded RGBA image into the box (x, y, w, h), scaling to fit
  // inside it (never cropping or stretching) and centering the leftover
  // margin - nearest-neighbor only, which matches the pixel-art look every
  // other card asset already has instead of introducing a blurrier resize.
  // Source alpha is composited over whatever's already on the canvas, since
  // the canvas itself has no alpha channel to composite onto.
  drawImage(img: DecodedImage, x: number, y: number, w: number, h: number): void {
    const scale = Math.min(w / img.width, h / img.height);
    const dw = Math.max(1, Math.round(img.width * scale));
    const dh = Math.max(1, Math.round(img.height * scale));
    const ox = x + (w - dw) / 2;
    const oy = y + (h - dh) / 2;

    const x0 = Math.max(0, Math.round(ox));
    const y0 = Math.max(0, Math.round(oy));
    const x1 = Math.min(this.width, Math.round(ox + dw));
    const y1 = Math.min(this.height, Math.round(oy + dh));

    for (let py = y0; py < y1; py++) {
      const sy = Math.min(img.height - 1, Math.floor(((py - oy) / dh) * img.height));
      for (let px = x0; px < x1; px++) {
        const sx = Math.min(img.width - 1, Math.floor(((px - ox) / dw) * img.width));
        const si = (sy * img.width + sx) * 4;
        const a = img.rgba[si + 3]! / 255;
        if (a <= 0) continue;
        const di = (py * this.width + px) * 3;
        if (a >= 1) {
          this.px[di] = img.rgba[si]!;
          this.px[di + 1] = img.rgba[si + 1]!;
          this.px[di + 2] = img.rgba[si + 2]!;
        } else {
          this.px[di] = Math.round(img.rgba[si]! * a + this.px[di]! * (1 - a));
          this.px[di + 1] = Math.round(img.rgba[si + 1]! * a + this.px[di + 1]! * (1 - a));
          this.px[di + 2] = Math.round(img.rgba[si + 2]! * a + this.px[di + 2]! * (1 - a));
        }
      }
    }
  }

  encode(): Uint8Array {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, this.width);
    view.setUint32(4, this.height);
    ihdr[8] = 8;
    ihdr[9] = 2;

    const stride = this.width * 3;
    const raw = new Uint8Array((stride + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw.set(this.px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }

    // IDAT is a zlib stream, not raw deflate. Bun.deflateSync gives raw, which
    // produces a file that passes `file` and then fails in every real decoder.
    const idat = new Uint8Array(deflateSync(raw));

    const parts = [
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

export interface DecodedImage {
  width: number;
  height: number;
  // Always RGBA regardless of the source color type, so drawImage never has
  // to branch on it.
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Largest image decodePNG will allocate for. Decoding holds the inflated
// scanlines, the unfiltered pixels and the RGBA output at once (~12 bytes a
// pixel), and the bytes come from player-set URLs, so a header claiming a huge
// canvas is refused before anything is allocated. 3840x2160 still fits a 4K
// screenshot, and every card only draws a thumbnail anyway.
export const MAX_DECODE_PIXELS = 3840 * 2160;

// Decodes an 8-bit, non-interlaced PNG (grayscale, RGB, palette, or their
// +alpha variants) into flat RGBA. Item photos are ordinary exported PNGs,
// so that covers everything that actually shows up in practice - anything
// else (16-bit, interlaced, sub-byte depths, larger than MAX_DECODE_PIXELS)
// throws, and callers fall back to a text-only card rather than fail the
// whole preview.
export function decodePNG(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let paletteAlpha: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];

  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 8);
    const len = view.getUint32(0);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + len);

    if (type === "IHDR") {
      if (data.length < 13) throw new Error("truncated PNG header");
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0);
      height = dv.getUint32(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const interlace = data[12]!;
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error("unsupported interlaced PNG");
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "tRNS") {
      paletteAlpha = data.slice();
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }

    pos += 12 + len;
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error("palette PNG missing PLTE");
  if (width === 0 || height === 0) throw new Error("PNG missing IHDR");
  if (width * height > MAX_DECODE_PIXELS) throw new Error(`PNG too large (${width}x${height})`);

  const total = idatParts.reduce((n, p) => n + p.length, 0);
  const idat = new Uint8Array(total);
  let at = 0;
  for (const p of idatParts) {
    idat.set(p, at);
    at += p.length;
  }

  const bpp = channels;
  const stride = width * channels;
  // One filter byte plus `stride` bytes per row. Capping the inflate there
  // stops a tiny zlib bomb from expanding past what the header declared.
  const expected = (stride + 1) * height;
  const raw = inflateSync(idat, { maxOutputLength: expected });
  if (raw.length < expected) throw new Error("truncated PNG data");
  const recon = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)]!;
    const srcOff = y * (stride + 1) + 1;
    const dstOff = y * stride;
    const prevOff = dstOff - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[srcOff + i]!;
      const a = i >= bpp ? recon[dstOff + i - bpp]! : 0;
      const b = y > 0 ? recon[prevOff + i]! : 0;
      const c = y > 0 && i >= bpp ? recon[prevOff + i - bpp]! : 0;
      let v: number;
      switch (filterType) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`unsupported PNG filter type ${filterType}`);
      }
      recon[dstOff + i] = v & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const si = p * channels;
    const di = p * 4;
    if (colorType === 2) {
      rgba[di] = recon[si]!; rgba[di + 1] = recon[si + 1]!; rgba[di + 2] = recon[si + 2]!; rgba[di + 3] = 255;
    } else if (colorType === 6) {
      rgba[di] = recon[si]!; rgba[di + 1] = recon[si + 1]!; rgba[di + 2] = recon[si + 2]!; rgba[di + 3] = recon[si + 3]!;
    } else if (colorType === 0) {
      const g = recon[si]!;
      rgba[di] = g; rgba[di + 1] = g; rgba[di + 2] = g; rgba[di + 3] = 255;
    } else if (colorType === 4) {
      const g = recon[si]!;
      rgba[di] = g; rgba[di + 1] = g; rgba[di + 2] = g; rgba[di + 3] = recon[si + 1]!;
    } else if (colorType === 3) {
      const idx = recon[si]!;
      rgba[di] = palette![idx * 3]!; rgba[di + 1] = palette![idx * 3 + 1]!; rgba[di + 2] = palette![idx * 3 + 2]!;
      rgba[di + 3] = paletteAlpha && idx < paletteAlpha.length ? paletteAlpha[idx]! : 255;
    }
  }

  return { width, height, rgba };
}
