import type { HackatimeBreakdown } from "./hackatime";

export interface HackatimeDonutSlice {
  label: string;
  value: number;
  percent: number;
  color: string;
}

// The source is Hackatime's duration breakdown, not the potentially rounded
// percent field. Derive shares from seconds so the donut always totals 100%.
const PALETTE = [
  "var(--hc-cyan)",
  "var(--hc-purple)",
  "var(--hc-orange)",
  "var(--hc-green)",
  "var(--hc-yellow)",
  "var(--hc-blue)",
] as const;

function safeColor(color: string | undefined, fallback: string): string {
  // Hackatime supplies language colors as hex. Don't inject arbitrary
  // third-party strings into CSS variables / SVG fills.
  return color && /^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color) ? color : fallback;
}

export function hackatimeDonutSlices(
  items: readonly HackatimeBreakdown[],
  maxNamedSlices = 6,
): HackatimeDonutSlice[] {
  const valid = items
    .filter((item) => Number.isFinite(item.seconds) && item.seconds > 0 && item.name.trim().length > 0)
    .map((item) => ({ label: item.name.trim(), value: item.seconds, sourceColor: item.color }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = valid.reduce((sum, row) => sum + row.value, 0);
  if (!(total > 0)) return [];

  // At most six named categories, and an honest "Other" slice for the rest.
  const limit = Math.max(1, Math.floor(maxNamedSlices) || 1);
  const main = valid.slice(0, limit).map((row, i) => ({
    label: row.label,
    value: row.value,
    percent: (row.value / total) * 100,
    color: safeColor(row.sourceColor, PALETTE[i % PALETTE.length]),
  }));
  const remainder = valid.slice(limit).reduce((sum, row) => sum + row.value, 0);
  if (remainder > 0) {
    main.push({
      label: "Other categories",
      value: remainder,
      percent: (remainder / total) * 100,
      color: "var(--border-strong)",
    });
  }
  return main;
}
