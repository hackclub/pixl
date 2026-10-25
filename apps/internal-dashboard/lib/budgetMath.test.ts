import { describe, expect, test } from "bun:test";
import { combineReviewerTotals, costCoverage, nominalValueCents } from "./budgetMath";

describe("migration-free budget math", () => {
  test("joins payout settlements and wallet transactions without losing wallet-only reviewers", () => {
    expect(combineReviewerTotals(
      [
        { slackId: "U1", paidReviews: 2, pendingReviews: 1, recordedPaidPx: 30, creditedPx: 20 },
        { slackId: "U2", paidReviews: 1, pendingReviews: 0, recordedPaidPx: 10, creditedPx: 10 },
      ],
      [
        { slackId: "U1", netWalletPx: 15 }, // 20 credited, minus a 5 px correction
        { slackId: "U3", netWalletPx: 50 }, // backfill without a payout row
        { slackId: "U2", netWalletPx: -10 }, // reversal after payout
      ],
    )).toEqual([
      { slackId: "U3", paidReviews: 0, pendingReviews: 0, recordedPaidPx: 0, creditedPx: 0, netWalletPx: 50 },
      { slackId: "U1", paidReviews: 2, pendingReviews: 1, recordedPaidPx: 30, creditedPx: 20, netWalletPx: 15 },
      { slackId: "U2", paidReviews: 1, pendingReviews: 0, recordedPaidPx: 10, creditedPx: 10, netWalletPx: -10 },
    ]);
  });

  test("shows payout rows without linked wallet credits, including unlinked payout records", () => {
    expect(combineReviewerTotals(
      [{ slackId: "", paidReviews: 1, pendingReviews: 2, recordedPaidPx: 30, creditedPx: 0 }],
      [],
    )).toEqual([
      { slackId: "", paidReviews: 1, pendingReviews: 2, recordedPaidPx: 30, creditedPx: 0, netWalletPx: 0 },
    ]);
  });

  test("treats empty order history as unknown coverage rather than 100%", () => {
    expect(costCoverage(0, 0)).toBeNull();
    expect(costCoverage(5, 4)).toBe(80);
    expect(costCoverage(4, 4)).toBe(100);
  });

  test("keeps pixel values explicitly nominal, with cent rounding", () => {
    expect(nominalValueCents(125, 0.1)).toBe(1250);
    expect(nominalValueCents(-5, 0.1)).toBe(-50);
  });
});