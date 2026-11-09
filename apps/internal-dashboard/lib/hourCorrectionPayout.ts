/**
 * Recalculate a post-approval hours correction from the beneficiary's EXISTING
 * payout, including any referral boosts and community-goal bonuses that were
 * paid when the project was approved.
 *
 * Scale gross pixels (paid pixels plus any hardware grant withheld) by the
 * ratio of approved hours. Subtract the original fixed grant again afterwards.
 * Do not re-run referral eligibility, community goals or today's RE rate:
 * those may differ from the bonuses/rate actually paid on this project.
 *
 * Taking the current ledger total as the baseline makes repeated adjustments
 * work in either direction. A previously paid bonus remains on retained hours.
 */
export function correctedPayoutPixels({
  paidPx,
  previousHours,
  correctedHours,
  fundingDeductedPx = 0,
}: {
  paidPx: number;
  previousHours: number;
  correctedHours: number;
  fundingDeductedPx?: number;
}): number {
  if (
    ![paidPx, previousHours, correctedHours, fundingDeductedPx].every(Number.isFinite) ||
    !Number.isInteger(paidPx) ||
    !Number.isInteger(fundingDeductedPx) ||
    paidPx < 0 ||
    fundingDeductedPx < 0 ||
    previousHours <= 0 ||
    correctedHours < 0
  ) {
    throw new Error("Invalid payout history or correction hours; refusing to adjust pixels.");
  }

  const previouslyPaidGross = paidPx + fundingDeductedPx;
  const correctedGross = Math.round(previouslyPaidGross * (correctedHours / previousHours));
  return Math.max(0, correctedGross - fundingDeductedPx);
}
