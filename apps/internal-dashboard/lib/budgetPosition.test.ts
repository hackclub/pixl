import { expect, test } from "bun:test";
import { reserveLines, type BudgetPosition } from "./budgetPosition";

test("reserves match the audited snapshot without deducting credited rewards twice", () => {
  const p: BudgetPosition = { walletsPx: 47433, negativeWalletsPx: -722,
    pendingOrdersPx: 7118, orderedPx: 1394, pendingOrders: 22, orderedOrders: 8,
    fulfilledPx: 59082, fulfilledOrders: 118,
    heldTrialPx: 294, pendingReviewPx: 60, uncreditedReviewPx: 8,
    walletDriftPx: 2450, walletDriftAccounts: 19, reviewerNames: {}, readAt: "now" };
  const rows = reserveLines(p, 0.1);
  const reserved = rows.reduce((total, row) => total + row.cents, 0);
  expect(reserved).toBe(563070);
  expect(959828 - reserved).toBe(396758);
  expect(rows[1].cents).toBe(71180); // price already includes quantity
  expect(rows[0].cents).toBe(474330); // negative wallets do not offset obligations
});
