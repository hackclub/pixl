import { describe, expect, test } from "bun:test";
import { buildTokens } from "./tokens.ts";

const config = {
  hackatimeCutoff: "2026-08-18T00:00:00Z",
  economy: {
    pixelValueUsd: 0.07,
    basePayoutUsd: 3.5,
    maxPayoutUsd: 6.0,
    reForMaxPayout: 5000,
    tierRePerHour: [5, 10, 15, 25],
    tierKickerUsdPerStep: 0.5,
    tierKickerHours: 40,
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
    expect(tokens.basePx).toBe("50 px");
    expect(tokens.maxPx).toBe("86 px");
    expect(tokens.baseUsd).toBe("$3.50");
    expect(tokens.maxUsd).toBe("$6.00");
    expect(tokens.reCap).toBe("5,000");
    expect(tokens.maxLevel).toBe("100");
  });

  test("resolves tier rates and the trial bonus", () => {
    const tokens = buildTokens(config);
    expect(tokens.t1).toBe("5");
    expect(tokens.t2).toBe("10");
    expect(tokens.t3).toBe("15");
    expect(tokens.t4).toBe("25");
    expect(tokens.trialBonusRe).toBe("25");
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
