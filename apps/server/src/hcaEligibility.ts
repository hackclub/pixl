export interface HcaClaims {
  verification_status?: unknown;
  ysws_eligible?: unknown;
}

// One-off exceptions for a specific player's own account, never a general
// escape hatch - each entry needs its own comment explaining why, since this
// bypasses a real eligibility check. Deliberately a hardcoded allowlist here
// rather than a DB column: a DB flag would get silently overwritten back to
// whatever HCA reports on that player's very next login (see hcaStatePatch/
// persistHcaState in routes/auth.ts, which re-syncs hca_ysws_eligible from
// HCA on every login), while this survives that.
export const MANUAL_ELIGIBILITY_OVERRIDE_USER_IDS = new Set<string>([
  // Oluwajubeelo Lawal (project 621, "ArgueIt") - HCA has this identity as
  // verification_status "verified" but has never set a ysws_eligible flag at
  // all (confirmed via a fresh re-sync, not stale Pixl-side data) - a gap on
  // HCA's own side, not a real rejection. Approved by Gabin, 2026-10-01.
  "a893cc19-1b35-42c9-86df-1e0ffbf1cc50",
]);

export interface HcaStateRow {
  hca_verification_status?: string | null;
  hca_ysws_eligible?: boolean | null;
}

export function cleanVerificationStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function cleanYswsEligible(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function isSignupRejected(claims: HcaClaims): boolean {
  const status = cleanVerificationStatus(claims.verification_status);
  if (status === "ineligible") return true;
  return status === "verified" && claims.ysws_eligible !== true;
}

export function hcaStatePatch(claims: HcaClaims): HcaStateRow {
  const status = cleanVerificationStatus(claims.verification_status);
  if (!status) return {};
  return {
    hca_verification_status: status,
    hca_ysws_eligible: cleanYswsEligible(claims.ysws_eligible),
  };
}

export type ShipBlockCode = "hca_verification_required" | "hca_ineligible";

export interface ShipBlock {
  error: ShipBlockCode;
  message: string;
  status: string | null;
}

const VERIFY_MESSAGE =
  "Verify your identity on Hack Club Auth before shipping. Already did? Re-check your status to pull it in from Hack Club Auth.";

const INELIGIBLE_MESSAGE =
  "You're not eligible to ship. Hack Club Auth has this identity as ineligible for YSWS programs. If you think that's a mistake, reach out to the Pixl team.";

export function shipEligibilityBlock(row: HcaStateRow | null | undefined): ShipBlock | null {
  const status = cleanVerificationStatus(row?.hca_verification_status);
  if (status === "verified") {
    return row?.hca_ysws_eligible === true
      ? null
      : { error: "hca_ineligible", message: INELIGIBLE_MESSAGE, status };
  }
  if (status === null || status === "needs_submission" || status === "pending") {
    return { error: "hca_verification_required", message: VERIFY_MESSAGE, status };
  }
  return { error: "hca_ineligible", message: INELIGIBLE_MESSAGE, status };
}

export function hcaStateChanged(current: HcaStateRow | null | undefined, patch: HcaStateRow): boolean {
  if (patch.hca_verification_status === undefined) return false;
  return (
    cleanVerificationStatus(current?.hca_verification_status) !== patch.hca_verification_status ||
    cleanYswsEligible(current?.hca_ysws_eligible) !== (patch.hca_ysws_eligible ?? null)
  );
}

export type HcaSyncOutcome = "verified" | "pending" | "needs_submission" | "ineligible" | "unknown";

export function hcaSyncOutcome(row: HcaStateRow | null | undefined): HcaSyncOutcome {
  const block = shipEligibilityBlock(row);
  if (!block) return "verified";
  if (block.error === "hca_ineligible") return "ineligible";
  return block.status === "pending" || block.status === "needs_submission" ? block.status : "unknown";
}
