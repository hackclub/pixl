// Stable UTC dates for chart axes: avoid browser-local timezone shifts at midnight.
export function chartUtcDate(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

export function dateLabel(isoDay: string): string {
  return chartUtcDate(isoDay).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

// Kept for callers that need the first, middle and final exact date labels.
export function sparseTicks(dates: string[]): string[] {
  const n = dates.length;
  const idx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  return idx.map((i) => dates[i]).filter(Boolean);
}
