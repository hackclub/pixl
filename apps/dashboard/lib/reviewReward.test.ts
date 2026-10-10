import { describe, expect, test } from "bun:test";
import { parseReviewReward, rewardLabel } from "./reviewReward";

describe("parseReviewReward", () => {
  test("reads a whole number of pixels", () => {
    expect(parseReviewReward("6")).toBe(6);
    expect(parseReviewReward("0")).toBe(0);
    expect(parseReviewReward("1250")).toBe(1250);
  });

  test("rejects anything that isn't a plain number", () => {
    expect(parseReviewReward(undefined)).toBeNull();
    expect(parseReviewReward(null)).toBeNull();
    expect(parseReviewReward("")).toBeNull();
    expect(parseReviewReward("-5")).toBeNull();
    expect(parseReviewReward("6.5")).toBeNull();
    expect(parseReviewReward("<b>6</b>")).toBeNull();
    expect(parseReviewReward("1234567")).toBeNull();
  });
});

describe("rewardLabel", () => {
  test("shows the amount", () => {
    expect(rewardLabel(6)).toBe("+6 pixels");
    expect(rewardLabel(1)).toBe("+1 pixel");
  });

  test("falls back when the verdict paid nothing", () => {
    expect(rewardLabel(0)).toBe("Review submitted!");
  });
});
