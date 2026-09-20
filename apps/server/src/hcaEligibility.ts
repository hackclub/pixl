export interface HcaClaims {
  verification_status?: unknown;
  ysws_eligible?: unknown;
}

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
}

const VERIFY_BLOCK: ShipBlock = {
  error: "hca_verification_required",
  message:
    "Verify your identity on Hack Club Auth before shipping. Already did? Log out and back in to refresh your status.",
};

const INELIGIBLE_BLOCK: ShipBlock = {
  error: "hca_ineligible",
  message:
    "You're not eligible to ship. Hack Club Auth has this identity as ineligible for YSWS programs. If you think that's a mistake, reach out to the Pixl team.",
};

export function shipEligibilityBlock(row: HcaStateRow | null | undefined): ShipBlock | null {
  const status = cleanVerificationStatus(row?.hca_verification_status);
  if (status === "verified") {
    return row?.hca_ysws_eligible === true ? null : INELIGIBLE_BLOCK;
  }
  if (status === null || status === "needs_submission" || status === "pending") {
    return VERIFY_BLOCK;
  }
  return INELIGIBLE_BLOCK;
}
