import { describe, expect, test } from "bun:test";
import { cappedUpdateHours } from "./updateHourCap";

const calc = (priorReviewedLoggedHours: number, priorApprovedHours: number, currentLoggedHours: number, currentClaimableHours = currentLoggedHours) =>
  cappedUpdateHours({ priorReviewedLoggedHours, priorApprovedHours, currentLoggedHours, currentClaimableHours });

describe("cappedUpdateHours", () => {
  test("10h logged, 8h approved, two new hours -> only two more hours payable", () => {
    expect(calc(10, 8, 12)).toEqual({ newHours: 2, maxCumulativeHours: 10, oldRejectedHours: 2 });
  });

  test("reshipping without new work cannot reclaim rejected time", () => {
    expect(calc(10, 8, 10)).toEqual({ newHours: 0, maxCumulativeHours: 8, oldRejectedHours: 2 });
  });

  test("does not reduce a legitimate update that previously had no deflation", () => {
    expect(calc(10, 10, 12)).toEqual({ newHours: 2, maxCumulativeHours: 12, oldRejectedHours: 0 });
  });

  test("preserves journal-entry deflation that already lowers current claimable total", () => {
    expect(calc(10, 8, 12, 9.5)).toMatchObject({ newHours: 2, maxCumulativeHours: 9.5 });
  });

  test("preserves decimal precision without paying rejected fractions", () => {
    expect(calc(10.4, 8.2, 12.6)).toEqual({ newHours: 2.2, maxCumulativeHours: 10.4, oldRejectedHours: 2.2 });
  });

  test("next approved update establishes a new baseline, without double crediting", () => {
    expect(calc(10, 8, 12).maxCumulativeHours).toBe(10);
    expect(calc(12, 10, 13).maxCumulativeHours).toBe(11);
  });

  test("clock resets or removed journals cannot mint new hours", () => {
    expect(calc(10, 8, 9)).toMatchObject({ newHours: 0, maxCumulativeHours: 8 });
  });

  test("rejects incomplete historical audit inputs rather than unlocking old rejected hours", () => {
    expect(() => calc(NaN, 8, 12)).toThrow(/invalid prior review/);
    expect(() => calc(10, -1, 12)).toThrow(/invalid prior review/);
    expect(() => calc(10, 8, Infinity)).toThrow(/invalid prior review/);
  });
});
