// Pure claim lookup. Opening a detail page must not acquire a claim.
export interface ReviewClaimFields {
  reviewing_by?: string | null;
  reviewing_at?: string | null;
}

export function activeReviewClaim(
  project: ReviewClaimFields,
  nowMs: number,
  lockMs: number,
): string | null {
  const holder = project.reviewing_by?.trim();
  if (!holder || !project.reviewing_at) return null;
  const at = Date.parse(project.reviewing_at);
  if (!Number.isFinite(at) || at > nowMs || nowMs - at >= lockMs) return null;
  return holder;
}
