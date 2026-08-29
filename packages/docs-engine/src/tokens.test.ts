import { describe, expect, test } from "bun:test";
import { buildTokens } from "./tokens.ts";

const config = {
  hackatimeCutoff: "2026-08-18T00:00:00Z",
  economy: {
    pixelValueUsd: 0.07,
    basePayoutUsd: 4.0,
    maxPayoutUsd: 6.0,
    reForMaxPayout: 3750,
    payoutSlopeRe: 1875,
    tierRePerHour: [10.714285714285714, 12.5, 15, 25],
    trialBonusRe: 25,
    levelBands: [
      { throughLevel: 10, rePerLevel: 10 },
      { throughLevel: 50, rePerLevel: 35 },
      { throughLevel: 100, rePerLevel: 70 },
    ],
  },
};

describe("buildTokens", () => {
  test("resolves the basic payout tokens from economy config", () => {
    const tokens = buildTokens(config);
    expect(tokens.basePx).toBe("57 px");
    expect(tokens.maxPx).toBe("86 px");
    expect(tokens.baseUsd).toBe("$4.00");
    expect(tokens.maxUsd).toBe("$6.00");
    expect(tokens.reCap).toBe("3,750");
    expect(tokens.maxLevel).toBe("100");
  });

  test("resolves tier rates and the trial bonus", () => {
    const tokens = buildTokens(config);
    expect(tokens.t1).toBe("10.71");
    expect(tokens.t2).toBe("12.5");
    expect(tokens.t3).toBe("15");
    expect(tokens.t4).toBe("25");
    expect(tokens.trialBonusRe).toBe("25");
  });

  test("resolves the payout step table, RE and hours-per-tier", () => {
    const tokens = buildTokens(config);
    // step1 = 0 RE → $4.00 (base rate)
    expect(tokens.step1Re).toBe("0");
    expect(tokens.step1Usd).toBe("$4.00");
    expect(tokens.step1T4h).toBe("0");
    // step3 = 1250 RE → $4.67
    expect(tokens.step3Re).toBe("1,250");
    expect(tokens.step3Usd).toBe("$4.67");
    expect(tokens.step3T4h).toBe("50");
    expect(tokens.step3T1h).toBe("117");
    // step7 = 3750 RE → $6.00 (max)
    expect(tokens.step7Re).toBe("3,750");
    expect(tokens.step7Usd).toBe("$6.00");
    expect(tokens.step7T4h).toBe("150");
    expect(tokens.step7T1h).toBe("350");
  });

  test("formats the hackatime cutoff in UTC regardless of local timezone", () => {
    const tokens = buildTokens(config);
    expect(tokens.cutoff).toBe("August 18, 2026");
  });

  test("computes cumulative RE totals per level band", () => {
    const tokens = buildTokens(config);
    expect(tokens.band1From).toBe("1");
    expect(tokens.band1To).toBe("10");
    expect(tokens.band1Total).toBe("100");
    expect(tokens.band2Total).toBe("1,500");
  });
});
