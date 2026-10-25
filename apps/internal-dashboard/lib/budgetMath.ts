// Pure helpers for the read-only Budget report. PIXL pixels are virtual
// rewards, never cash receipts or cash expenses.
export interface ReviewerPayoutAggregate {
  slackId: string;
  paidReviews: number;
  pendingReviews: number;
  recordedPaidPx: number;
  creditedPx: number;
}

export interface ReviewerWalletAggregate {
  slackId: string;
  netWalletPx: number;
}

export interface ReviewerBudgetRow extends ReviewerPayoutAggregate {
  netWalletPx: number;
}

export function combineReviewerTotals(
  payoutRows: readonly ReviewerPayoutAggregate[],
  walletRows: readonly ReviewerWalletAggregate[],
): ReviewerBudgetRow[] {
  const bySlackId = new Map<string, ReviewerBudgetRow>();
  for (const payout of payoutRows) {
    bySlackId.set(payout.slackId, { ...payout, netWalletPx: 0 });
  }
  // A reviewer can have wallet credits/backfills/corrections without any
  // remaining review_payouts rows. They must not disappear from the report.
  for (const wallet of walletRows) {
    const previous = bySlackId.get(wallet.slackId);
    bySlackId.set(wallet.slackId, {
      slackId: wallet.slackId,
      paidReviews: previous?.paidReviews ?? 0,
      pendingReviews: previous?.pendingReviews ?? 0,
      recordedPaidPx: previous?.recordedPaidPx ?? 0,
      creditedPx: previous?.creditedPx ?? 0,
      netWalletPx: wallet.netWalletPx,
    });
  }
  return [...bySlackId.values()].sort((a, b) =>
    b.netWalletPx - a.netWalletPx || b.paidReviews - a.paidReviews || a.slackId.localeCompare(b.slackId),
  );
}

export function costCoverage(processedOrders: number, processedWithCost: number): number | null {
  if (processedOrders === 0) return null;
  return Math.round((processedWithCost / processedOrders) * 100);
}

export function nominalValueCents(pixels: number, pixelValueUsd: number): number {
  return Math.round(pixels * pixelValueUsd * 100);
}