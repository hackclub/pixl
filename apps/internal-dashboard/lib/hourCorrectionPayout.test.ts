import { describe, expect, test } from "bun:test";
import { correctedPayoutPixels } from "./hourCorrectionPayout";

const correct = (paidPx: number, previousHours: number, correctedHours: number, fundingDeductedPx = 0) =>
  correctedPayoutPixels({ paidPx, previousHours, correctedHours, fundingDeductedPx });

describe("post-approval hours correction uses the original paid effective rate", () => {
  test("keeps +4 px/hr referral boost on all nine retained hours", () => {
    // Original: 10 * (40 + 4) = 440; 9h should retain the +4 bonus.
    expect(correct(440, 10, 9)).toBe(396);
    expect(440 - correct(440, 10, 9)).toBe(44); // not 80
  });

  test("keeps the community goal multiplier on retained hours", () => {
    // Original: 10 * 40 * 1.2 = 480.
    expect(correct(480, 10, 9)).toBe(432);
    expect(480 - correct(480, 10, 9)).toBe(48); // not 120
  });

  test("keeps referral and community goal bonuses together", () => {
    // Original: 10 * (40 + 4) * 1.2 = 528.
    expect(correct(528, 10, 9)).toBe(475);
  });

  test("preserves the RE-adjusted rate actually credited on approval", () => {
    expect(correct(453, 10, 9)).toBe(408);
  });

  test("repeated deflations retain the same original bonus on kept hours", () => {
    const after9 = correct(440, 10, 9);
    const after8 = correct(after9, 9, 8);
    expect(after8).toBe(352);
    expect(correct(after9, 9, 9)).toBe(after9);
  });

  test("preserves the original fixed hardware grant, not a proportion of it", () => {
    // Original gross 440 px, 100 px grant withheld, 340 px credited.
    expect(correct(340, 10, 9, 100)).toBe(296);
    expect(correct(340, 10, 0, 100)).toBe(0);
  });

  test("works for individual collaborators with independently credited hours", () => {
    expect(correct(220, 5, 4)).toBe(176);
  });

  test("never mints pixels when a zero-payout project is corrected", () => {
    expect(correct(0, 10, 9)).toBe(0);
  });

  test("fails closed for invalid hours or ledger values", () => {
    expect(() => correct(440, 0, 9)).toThrow();
    expect(() => correct(440, 10, Number.NaN)).toThrow();
    expect(() => correct(-10, 10, 9)).toThrow();
    expect(() => correct(440, 10, 9, -1)).toThrow();
  });
});
