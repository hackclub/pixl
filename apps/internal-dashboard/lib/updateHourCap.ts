/**
 * Update reviews must distinguish the total TRACKED time that was previously
 * reviewed from the time actually APPROVED. Rejected old time never becomes
 * "new" just because a player ships again.
 *
 * Example: reviewed 10h, approved 8h, later logged 12h -> 2 new hours and
 * 10h maximum cumulative approval, NOT 12h. The paid delta is at most 2h.
 *
 * The logged baseline comes from the most recent FINAL approved review audit
 * (review_audits.claimed_hours). For collaborators it is captured separately
 * at their final approval. Never use previously approved hours as that raw
 * baseline, or a prior deflation can be paid out again.
 */
export function cappedUpdateHours({
  priorApprovedHours,
  priorReviewedLoggedHours,
  currentLoggedHours,
  currentClaimableHours,
}: {
  priorApprovedHours: number;
  priorReviewedLoggedHours: number;
  currentLoggedHours: number;
  currentClaimableHours: number;
}): { newHours: number; maxCumulativeHours: number; oldRejectedHours: number } {
  const numbers = [priorApprovedHours, priorReviewedLoggedHours, currentLoggedHours, currentClaimableHours];
  if (numbers.some((x) => !Number.isFinite(x) || x < 0)) {
    throw new Error("Missing or invalid prior review hours; refusing to approve an update.");
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const newHours = Math.max(0, round1(currentLoggedHours - priorReviewedLoggedHours));
  // Never lower the already banked hours just because the raw tracking source
  // was edited/reset. An update is NOT an administrative correction action.
  const maxCumulativeHours = Math.min(
    currentClaimableHours,
    round1(priorApprovedHours + newHours),
  );
  return {
    newHours,
    maxCumulativeHours: round1(maxCumulativeHours),
    oldRejectedHours: Math.max(0, round1(priorReviewedLoggedHours - priorApprovedHours)),
  };
}
