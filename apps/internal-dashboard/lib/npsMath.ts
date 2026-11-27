// Pure maths for the NPS results page. No DB and no Next, so it is unit-testable.
// The standard NPS buckets: 9-10 promoters, 7-8 passives, 0-6 detractors.

export const NPS_AREAS = [
  { key: "onboarding", label: "Getting started and the rules" },
  { key: "reviews", label: "Review speed and fairness" },
  { key: "shop", label: "The shop and the prizes" },
  { key: "communication", label: "Communication (Slack, DMs, support)" },
] as const;

export interface NpsRow {
  wave: string;
  score: number;
  reason: string;
  fixText: string;
  ratings: Record<string, number>;
  createdAt: string;
  hasApproved: boolean;
  hasOrder: boolean;
  isStaff: boolean;
}

export type NpsBucket = "promoter" | "passive" | "detractor";

export function npsBucket(score: number): NpsBucket {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

// % promoters minus % detractors, rounded, -100..100. Null with no answers.
export function npsScore(rows: Pick<NpsRow, "score">[]): number | null {
  if (rows.length === 0) return null;
  const p = rows.filter((r) => npsBucket(r.score) === "promoter").length;
  const d = rows.filter((r) => npsBucket(r.score) === "detractor").length;
  return Math.round(((p - d) / rows.length) * 100);
}

export interface BucketShares {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** Whole percentages that always add up to 100 (largest remainder), 0s when empty. */
  pct: { promoters: number; passives: number; detractors: number };
}

export function bucketShares(rows: Pick<NpsRow, "score">[]): BucketShares {
  const total = rows.length;
  const promoters = rows.filter((r) => npsBucket(r.score) === "promoter").length;
  const passives = rows.filter((r) => npsBucket(r.score) === "passive").length;
  const detractors = total - promoters - passives;
  if (total === 0) return { total, promoters, passives, detractors, pct: { promoters: 0, passives: 0, detractors: 0 } };
  const raw = [promoters, passives, detractors].map((n) => (n / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return { total, promoters, passives, detractors, pct: { promoters: floors[0]!, passives: floors[1]!, detractors: floors[2]! } };
}

// How many answers gave each score 0..10.
export function scoreDistribution(rows: Pick<NpsRow, "score">[]): number[] {
  const out = Array.from({ length: 11 }, () => 0);
  for (const r of rows) if (Number.isInteger(r.score) && r.score >= 0 && r.score <= 10) out[r.score]! += 1;
  return out;
}

// Mean 1..5 rating per area, ignoring answers that skipped it.
export function averageRatings(rows: Pick<NpsRow, "ratings">[]): { key: string; label: string; avg: number | null; n: number }[] {
  return NPS_AREAS.map(({ key, label }) => {
    const values = rows.map((r) => r.ratings[key]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
    const n = values.length;
    return { key, label, n, avg: n ? Math.round((values.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null };
  });
}

export const SEGMENTS: { key: string; label: string; test: (r: NpsRow) => boolean }[] = [
  { key: "approved", label: "Has an approved project", test: (r) => r.hasApproved },
  { key: "no-approved", label: "No approved project yet", test: (r) => !r.hasApproved },
  { key: "ordered", label: "Placed a shop order", test: (r) => r.hasOrder },
  { key: "no-order", label: "Never ordered", test: (r) => !r.hasOrder },
  { key: "staff", label: "Staff (reviewer, fulfiller, helper)", test: (r) => r.isStaff },
];

// Below this many answers a segment's NPS swings too much to trust.
export const LOW_SAMPLE = 5;

export function npsBySegment(rows: NpsRow[]): { key: string; label: string; n: number; nps: number | null; low: boolean }[] {
  return SEGMENTS.map((s) => {
    const subset = rows.filter(s.test);
    return { key: s.key, label: s.label, n: subset.length, nps: npsScore(subset), low: subset.length < LOW_SAMPLE };
  });
}

// One point per wave, oldest first.
export function waveTrend(rows: NpsRow[]): { wave: string; n: number; nps: number | null }[] {
  const byWave = new Map<string, NpsRow[]>();
  for (const r of rows) byWave.set(r.wave, [...(byWave.get(r.wave) ?? []), r]);
  return [...byWave.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([wave, list]) => ({ wave, n: list.length, nps: npsScore(list) }));
}

export function isWave(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
