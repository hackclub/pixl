// 1200x630 player preview card - what a shared /players/<id> link unfurls to.
// Same LEDGER-dark frame as ./projectCard.ts and ./shopCard.ts (see ./png.ts
// for why these are standalone copies rather than imports of
// packages/docs-engine), laid out around the builder rather than a build:
// their avatar, their name, and the stats the in-game profile ticket shows.
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

function shard(canvas: Canvas, x: number, y: number, unit: number, color: Rgb): void {
  [1, 2, 3, 4, 3, 2, 1].forEach((w, i) => {
    canvas.fill(x - (w * unit) / 2, y + i * unit, w * unit, unit, color);
  });
}

// Trims until the text fits, since names and handles are free-text and a long
// one would otherwise run straight off the card.
function ellipsize(text: string, scale: number, maxWidth: number, tracking = 1): string {
  if (textWidth(text, scale, tracking) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, scale, tracking) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.replace(/[.\s]+$/, "")}...`;
}

export interface PlayerCardInput {
  name: string;
  level: number;
  /** Approved hours (xp_hours). */
  hours: number;
  /** Approved ships. */
  projects: number;
  /** ISO join date; only the year is shown. */
  joined: string | null;
  /** Canonical host for the footer, e.g. "pixl.hackclub.com". */
  siteHost: string;
  // Raw bytes of the player's avatar_url response, or null if it couldn't be
  // fetched/decoded - the card falls back to an initial tile.
  avatarBytes: Uint8Array | null;
}

const STAT_GAP = 34;

function statWidth(label: string, value: string, valueScale: number): number {
  return Math.max(textWidth(label, 3, 2), textWidth(value, valueScale, 1));
}

// Picks the largest value size at which the whole strip still fits. Dividing
// the column evenly instead let a wide value ("1042H") run straight under the
// next label.
function fitStatScale(cells: [string, string][], maxWidth: number): number {
  for (let s = 7; s > 3; s--) {
    const total =
      cells.reduce((sum, [l, v]) => sum + statWidth(l, v, s), 0) + STAT_GAP * (cells.length - 1);
    if (total <= maxWidth) return s;
  }
  return 3;
}

export function renderPlayerCard({
  name,
  level,
  hours,
  projects,
  joined,
  siteHost,
  avatarBytes,
}: PlayerCardInput): Uint8Array {
  const canvas = new Canvas(W, H, BG);

  const pad = 48;
  canvas.fill(pad, pad, W - pad * 2, H - pad * 2, PANEL);
  canvas.stroke(pad, pad, W - pad * 2, H - pad * 2, 3, STROKE);
  canvas.fill(pad, pad, 8, H - pad * 2, GOLD);

  // Square avatar box on the left, matching the profile ticket's framing.
  const box = 300;
  const boxX = pad + 64;
  const boxY = (H - box) / 2;
  canvas.fill(boxX, boxY, box, box, BG);
  canvas.stroke(boxX, boxY, box, box, 2, STROKE);

  let avatar: DecodedImage | null = null;
  if (avatarBytes) {
    try {
      avatar = decodePNG(avatarBytes);
    } catch {
      // Slack and gravatar hand back JPEGs and ./png.ts only decodes PNG, so
      // most avatars land here. The initial tile below covers them.
      avatar = null;
    }
  }
  if (avatar) {
    const inset = 12;
    canvas.drawImage(avatar, boxX + inset, boxY + inset, box - inset * 2, box - inset * 2);
  } else {
    // A big initial in the accent colour, so the card still reads as "a
    // person" rather than showing an empty frame.
    const initial = (name.trim()[0] ?? "?").toUpperCase();
    const scale = 22;
    drawText(
      canvas,
      initial,
      boxX + (box - textWidth(initial, scale, 1)) / 2,
      boxY + (box - GLYPH_H * scale) / 2,
      scale,
      GOLD,
    );
  }

  const left = boxX + box + 64;
  const right = W - pad - 64;
  const maxWidth = right - left;

  shard(canvas, left + 10, pad + 78, 5, GOLD);
  drawText(canvas, "PIXL BUILDER", left + 44, pad + 80, 4, GOLD, 2);

  const footY = H - pad - 78;

  // Name sits above the stat strip, shrinking before it ever reaches it.
  const statTop = footY - 28 - (GLYPH_H * 3 + 16 + GLYPH_H * 7);
  const blockTop = pad + 176;
  const nameSpace = statTop - 28 - blockTop;
  const lineHeightAt = (s: number) => GLYPH_H * s + 20;

  let scale = 11;
  let lines = wrap(name.toUpperCase(), scale, maxWidth);
  while (scale > 4 && lines.length * lineHeightAt(scale) > nameSpace) {
    scale -= 1;
    lines = wrap(name.toUpperCase(), scale, maxWidth);
  }
  const lineHeight = lineHeightAt(scale);
  const maxLines = Math.max(1, Math.floor(nameSpace / lineHeight));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines.length - 1;
    lines[last] = `${lines[last]!}...`;
  }
  // Every line, not just a truncated one: wrap() can't break a single word
  // longer than the column, and a name like "TheBlueReverberation" is exactly
  // that, so without this it ran off the right edge of the card.
  lines = lines.map((line) => ellipsize(line, scale, maxWidth));
  const nameTop = blockTop + Math.max(0, (nameSpace - lines.length * lineHeight) / 2);
  lines.forEach((line, i) => drawText(canvas, line, left, nameTop + i * lineHeight, scale, INK));

  const cells: [string, string][] = [
    ["LEVEL", String(level || 1)],
    ["HOURS", `${Math.round(hours)}H`],
    ["SHIPS", String(projects)],
  ];
  if (joined) cells.push(["JOINED", String(new Date(joined).getUTCFullYear())]);
  const valueScale = fitStatScale(cells, maxWidth);
  let statX = left;
  for (const [label, value] of cells) {
    drawText(canvas, label, statX, statTop, 3, DIM, 2);
    drawText(canvas, value, statX, statTop + GLYPH_H * 3 + 16, valueScale, INK, 1);
    statX += statWidth(label, value, valueScale) + STAT_GAP;
  }

  canvas.fill(left, footY, maxWidth, 2, STROKE);
  drawText(canvas, siteHost.toUpperCase(), left, footY + 26, 3, TEAL, 2);

  return canvas.encode();
}
