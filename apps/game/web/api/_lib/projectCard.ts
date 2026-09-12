// 1200x630 project preview card - the "ship receipt" a shared /project/<id>
// link shows. Same LEDGER-dark frame as ./shopCard.ts (see ./png.ts for why
// these are standalone copies rather than imports of packages/docs-engine),
// but laid out around a project's thumbnail instead of a shop photo, with the
// facts that make a shipped project worth bragging about: who built it, how
// many hours went in, and where it is in review.
//
// Deliberately no payout figure. The endpoint this card is built from
// (GET /api/explore/projects/:id) doesn't expose one, and a shareable image
// is the wrong place to publish what someone earned.
import { Canvas, hex, decodePNG, type DecodedImage, type Rgb } from "./png.ts";
import { drawText, textWidth, wrap, GLYPH_H } from "./font.ts";

const W = 1200;
const H = 630;

const BG = hex("#171615");
const PANEL = hex("#211f1e");
const STROKE = hex("#38352f");
const GOLD = hex("#d99a1f");
const INK = hex("#ece8e2");
const DIM = hex("#a49e93");
const TEAL = hex("#4fb3a5");
const GREEN = hex("#6fae52");
const RED = hex("#c4553d");

function shard(canvas: Canvas, x: number, y: number, unit: number, color: Rgb): void {
  [1, 2, 3, 4, 3, 2, 1].forEach((w, i) => {
    canvas.fill(x - (w * unit) / 2, y + i * unit, w * unit, unit, color);
  });
}

// Mirrors statusChip() in web/explore/index.html so the card and the page
// label a project the same way.
const STATUS_LABELS: Record<string, [string, Rgb]> = {
  approved: ["SHIPPED", GREEN],
  shipped: ["IN REVIEW", TEAL],
  second_review: ["IN REVIEW", TEAL],
  fraud_review: ["IN REVIEW", TEAL],
  building: ["BUILDING", DIM],
  needs_changes: ["NEEDS CHANGES", RED],
};

export interface ProjectCardInput {
  name: string;
  owner: string;
  /** Tracked seconds (hackatime_seconds). 0/undefined hides the hours pill. */
  seconds: number;
  status: string;
  /** Reviewer-nominated standout. Adds a star to the eyebrow. */
  isPeak?: boolean;
  /** Canonical host for the footer, e.g. "pixl.hackclub.com". */
  siteHost: string;
  // Raw bytes of the project's image_url response, or null if it couldn't be
  // fetched/decoded - the card still renders fine without it.
  imageBytes: Uint8Array | null;
}

// Outlined pills, the card's stand-in for the page's .chip. Laid out
// left-to-right and wrapped onto another row when the column runs out, since
// the text column here is narrow (~500px) and a status like "NEEDS CHANGES"
// next to an hours pill doesn't fit on one line.
const PILL_SCALE = 3;
const PILL_PAD_X = 14;
const PILL_PAD_Y = 10;
const PILL_GAP = 14;
const PILL_H = GLYPH_H * PILL_SCALE + PILL_PAD_Y * 2;

function pillWidth(text: string): number {
  return textWidth(text, PILL_SCALE, 2) + PILL_PAD_X * 2;
}

// Trims `text` until it (plus an ellipsis, if anything was cut) fits inside
// maxWidth. wrap() alone isn't enough for either caller here: a single word
// longer than the column gets a line to itself and still overflows, and
// appending "..." to an already-full wrapped line pushes it back over.
function ellipsize(text: string, scale: number, maxWidth: number, tracking = 1): string {
  if (textWidth(text, scale, tracking) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, scale, tracking) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.replace(/[.\s]+$/, "")}...`;
}

/** Row-wraps `pills` into `maxWidth` and returns the rows, for measuring. */
function layoutPills(pills: [string, Rgb][], maxWidth: number): [string, Rgb][][] {
  const rows: [string, Rgb][][] = [];
  let row: [string, Rgb][] = [];
  let used = 0;
  for (const p of pills) {
    const w = pillWidth(p[0]);
    if (row.length && used + PILL_GAP + w > maxWidth) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(p);
    used += (row.length > 1 ? PILL_GAP : 0) + w;
  }
  if (row.length) rows.push(row);
  return rows;
}

function drawPills(canvas: Canvas, rows: [string, Rgb][][], x: number, y: number): void {
  rows.forEach((row, r) => {
    let cursor = x;
    for (const [text, color] of row) {
      const w = pillWidth(text);
      canvas.stroke(cursor, y + r * (PILL_H + 10), w, PILL_H, 2, color);
      drawText(canvas, text, cursor + PILL_PAD_X, y + r * (PILL_H + 10) + PILL_PAD_Y, PILL_SCALE, color, 2);
      cursor += w + PILL_GAP;
    }
  });
}

export function renderProjectCard({
  name,
  owner,
  seconds,
  status,
  isPeak,
  siteHost,
  imageBytes,
}: ProjectCardInput): Uint8Array {
  const canvas = new Canvas(W, H, BG);

  const pad = 48;
  canvas.fill(pad, pad, W - pad * 2, H - pad * 2, PANEL);
  canvas.stroke(pad, pad, W - pad * 2, H - pad * 2, 3, STROKE);
  canvas.fill(pad, pad, 8, H - pad * 2, GOLD);

  // Thumbnail box: 16:9 rather than shopCard's square, since project
  // thumbnails are screenshots, not product photos.
  const boxW = 420;
  const boxH = 236;
  const boxX = pad + 64;
  const boxY = (H - boxH) / 2;
  canvas.fill(boxX, boxY, boxW, boxH, BG);
  canvas.stroke(boxX, boxY, boxW, boxH, 2, STROKE);

  let image: DecodedImage | null = null;
  if (imageBytes) {
    try {
      image = decodePNG(imageBytes);
    } catch {
      // Uploads accept jpeg/webp too (apps/server/src/routes/uploads.ts) and
      // ./png.ts only decodes PNG - those land here and the card just keeps
      // the empty framed box.
      image = null;
    }
  }
  if (image) {
    const inset = 14;
    canvas.drawImage(image, boxX + inset, boxY + inset, boxW - inset * 2, boxH - inset * 2);
  }

  const left = boxX + boxW + 56;
  const right = W - pad - 64;
  const maxWidth = right - left;

  const eyebrow = isPeak ? "BEACON PROJECT" : "PIXL PROJECT";
  shard(canvas, left + 10, pad + 78, 5, GOLD);
  drawText(canvas, eyebrow, left + 44, pad + 80, 4, GOLD, 2);

  const blockTop = pad + 168;
  const footY = H - pad - 78;

  // The rest of the right column is measured bottom-up from the footer rule,
  // so the pills and byline always keep their room and only the name gives
  // ground. Laying it out top-down instead let a long name push both of them
  // straight through the footer.
  const [statusLabel, statusColor] = STATUS_LABELS[status] ?? [
    status.replace(/_/g, " ").toUpperCase(),
    DIM,
  ];
  const pills: [string, Rgb][] = [[statusLabel, statusColor]];
  if (seconds > 0) pills.push([`${(seconds / 3600).toFixed(1)}H TRACKED`, GOLD]);
  const pillRows = layoutPills(pills, maxWidth);

  const pillBlockH = pillRows.length * PILL_H + (pillRows.length - 1) * 10;
  const pillY = footY - 28 - pillBlockH;
  const bylineY = pillY - GLYPH_H * 4 - 26;
  const nameSpace = bylineY - 16 - blockTop;

  const lineHeightAt = (s: number) => GLYPH_H * s + 22;
  let scale = 10;
  let lines = wrap(name.toUpperCase(), scale, maxWidth);
  while (scale > 4 && lines.length * lineHeightAt(scale) > nameSpace) {
    scale -= 1;
    lines = wrap(name.toUpperCase(), scale, maxWidth);
  }
  // Floor reached and it still doesn't fit (a genuinely huge name): keep the
  // lines that do and mark the cut, rather than painting over the byline.
  const lineHeight = lineHeightAt(scale);
  const maxLines = Math.max(1, Math.floor(nameSpace / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines.length - 1;
    lines[last] = ellipsize(`${lines[last]!}...`, scale, maxWidth);
  }
  // Centred in whatever vertical room is left, so a one-line name doesn't
  // sit marooned at the top of a tall gap.
  const nameTop = blockTop + Math.max(0, (nameSpace - lines.length * lineHeight) / 2);
  lines.forEach((line, i) => drawText(canvas, line, left, nameTop + i * lineHeight, scale, INK));

  const byline = ellipsize(`BY ${owner.toUpperCase()}`, 4, maxWidth, 2);
  drawText(canvas, byline, left, bylineY, 4, DIM, 2);
  drawPills(canvas, pillRows, left, pillY);

  canvas.fill(left, footY, maxWidth, 2, STROKE);
  drawText(canvas, siteHost.toUpperCase(), left, footY + 26, 3, DIM, 2);

  return canvas.encode();
}
