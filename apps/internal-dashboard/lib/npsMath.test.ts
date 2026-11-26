import { describe, expect, test } from "bun:test";
import {
  LOW_SAMPLE,
  averageRatings,
  bucketShares,
  isWave,
  npsBucket,
  npsBySegment,
  npsScore,
  scoreDistribution,
  waveTrend,
  type NpsRow,
} from "./npsMath";

function row(score: number, extra: Partial<NpsRow> = {}): NpsRow {
  return {
    wave: "2026-11",
    score,
    reason: "",
    fixText: "",
    ratings: {},
    createdAt: "2026-11-15T10:00:00.000Z",
    hasApproved: false,
    hasOrder: false,
    isStaff: false,
    ...extra,
  };
}

describe("npsBucket", () => {
  test("splits 0-6, 7-8 and 9-10", () => {
    expect([0, 6].map(npsBucket)).toEqual(["detractor", "detractor"]);
    expect([7, 8].map(npsBucket)).toEqual(["passive", "passive"]);
    expect([9, 10].map(npsBucket)).toEqual(["promoter", "promoter"]);
  });
});

describe("npsScore", () => {
  test("is promoters minus detractors as a rounded percentage", () => {
    expect(npsScore([10, 10, 9, 7, 3].map((s) => row(s)))).toBe(40);
    expect(npsScore([0, 1, 2].map((s) => row(s)))).toBe(-100);
    expect(npsScore([9, 10].map((s) => row(s)))).toBe(100);
    expect(npsScore([7, 8].map((s) => row(s)))).toBe(0);
    expect(npsScore([10, 6, 6].map((s) => row(s)))).toBe(-33);
  });
  test("is null with no answers", () => {
    expect(npsScore([])).toBeNull();
  });
});

describe("bucketShares", () => {
  test("counts each bucket and the percentages always add up to 100", () => {
    const shares = bucketShares([10, 10, 8, 3, 3, 3].map((s) => row(s)));
    expect(shares).toMatchObject({ total: 6, promoters: 2, passives: 1, detractors: 3 });
    expect(shares.pct.promoters + shares.pct.passives + shares.pct.detractors).toBe(100);
  });
  test("thirds still add up to 100", () => {
    const { pct } = bucketShares([10, 8, 3].map((s) => row(s)));
    expect(pct.promoters + pct.passives + pct.detractors).toBe(100);
  });
  test("empty is all zeros", () => {
    expect(bucketShares([]).pct).toEqual({ promoters: 0, passives: 0, detractors: 0 });
  });
});

describe("scoreDistribution", () => {
  test("has 11 slots and counts each score", () => {
    const d = scoreDistribution([0, 10, 10, 5].map((s) => row(s)));
    expect(d).toHaveLength(11);
    expect(d[0]).toBe(1);
    expect(d[5]).toBe(1);
    expect(d[10]).toBe(2);
    expect(d.reduce((a, b) => a + b, 0)).toBe(4);
  });
  test("ignores out-of-range or fractional scores", () => {
    expect(scoreDistribution([row(11), row(-1), row(4.5)]).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("averageRatings", () => {
  test("averages only the answers that rated the area, to one decimal", () => {
    const rows = [
      row(9, { ratings: { reviews: 4, shop: 5 } }),
      row(8, { ratings: { reviews: 3 } }),
      row(2, { ratings: {} }),
    ];
    const byKey = Object.fromEntries(averageRatings(rows).map((a) => [a.key, a]));
    expect(byKey.reviews).toMatchObject({ avg: 3.5, n: 2 });
    expect(byKey.shop).toMatchObject({ avg: 5, n: 1 });
    expect(byKey.onboarding).toMatchObject({ avg: null, n: 0 });
  });
  test("ignores out-of-range ratings", () => {
    const byKey = Object.fromEntries(averageRatings([row(5, { ratings: { reviews: 9, shop: 0 } })]).map((a) => [a.key, a]));
    expect(byKey.reviews!.avg).toBeNull();
    expect(byKey.shop!.avg).toBeNull();
  });
});

describe("npsBySegment", () => {
  test("splits by project, order and staff and flags small samples", () => {
    const rows = [
      row(10, { hasApproved: true, hasOrder: true }),
      row(9, { hasApproved: true }),
      row(2, { hasOrder: true, isStaff: true }),
      row(4),
    ];
    const seg = Object.fromEntries(npsBySegment(rows).map((s) => [s.key, s]));
    expect(seg.approved).toMatchObject({ n: 2, nps: 100, low: true });
    expect(seg["no-approved"]).toMatchObject({ n: 2, nps: -100 });
    expect(seg.ordered).toMatchObject({ n: 2, nps: 0 });
    expect(seg.staff).toMatchObject({ n: 1, nps: -100 });
    expect(LOW_SAMPLE).toBeGreaterThan(2);
  });
  test("a segment with enough answers is not flagged", () => {
    const rows = Array.from({ length: LOW_SAMPLE }, () => row(10, { hasApproved: true }));
    expect(npsBySegment(rows).find((s) => s.key === "approved")!.low).toBe(false);
  });
});

describe("waveTrend", () => {
  test("is one point per wave, oldest first", () => {
    const rows = [row(10, { wave: "2026-12" }), row(2, { wave: "2026-11" }), row(10, { wave: "2026-11" })];
    expect(waveTrend(rows)).toEqual([
      { wave: "2026-11", n: 2, nps: 0 },
      { wave: "2026-12", n: 1, nps: 100 },
    ]);
  });
});

describe("isWave", () => {
  test("accepts YYYY-MM only", () => {
    expect(isWave("2026-11")).toBe(true);
    expect(isWave("2026-13")).toBe(false);
    expect(isWave("2026-1")).toBe(false);
    expect(isWave("all")).toBe(false);
    expect(isWave(undefined)).toBe(false);
  });
});
