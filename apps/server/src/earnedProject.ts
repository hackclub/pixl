// A re-shipped project can be undergoing another review without losing the RE
// already approved on its previous ship. prior_approved_hours is captured on
// update shipping, and only that banked amount counts until reapproval.
export interface EarnedProjectRow {
  status: string;
  is_update: boolean | null;
  prior_approved_hours: number | null;
  approved_hours: number | null;
  hackatime_seconds: number | null;
}

export const EARNED_PROJECT_STATUSES = ["approved", "shipped", "needs_changes", "fraud_review", "second_review"];

export function earnedProjectHours(p: EarnedProjectRow): number | null {
  if (p.status === "approved") {
    const h = p.approved_hours != null ? Number(p.approved_hours) : (Number(p.hackatime_seconds) || 0) / 3600;
    return Number.isFinite(h) && h >= 0 ? h : 0;
  }
  if (p.is_update !== true || !EARNED_PROJECT_STATUSES.includes(p.status) || p.prior_approved_hours == null)
    return null;
  const h = Number(p.prior_approved_hours);
  return Number.isFinite(h) && h >= 0 ? h : null;
}

/**
 * Approved hours must keep the tier and Trial link that originally banked RE.
 * An update keeps its old hours in RE calculations while awaiting approval,
 * including during needs_changes, so its payout terms must stay frozen.
 */
export function mustPreserveApprovedProjectTerms(
  status: string | null | undefined,
  isUpdate: boolean | null | undefined,
): boolean {
  return status === "approved" || isUpdate === true;
}

/**
 * A collaborator only banks their OWN approved hours; owner hours or raw
 * Hackatime time awaiting review must never be counted on their behalf.
 */
export function earnedCollaboratorHours(
  project: Pick<EarnedProjectRow, "status" | "is_update">,
  collaboration: Pick<EarnedProjectRow, "approved_hours" | "prior_approved_hours">,
): number | null {
  return earnedProjectHours({
    status: project.status,
    is_update: project.is_update,
    approved_hours: collaboration.approved_hours,
    prior_approved_hours: collaboration.prior_approved_hours,
    hackatime_seconds: 0,
  });
}
