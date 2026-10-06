import type { VerdictCounts } from "@/app/_components/ReviewVerdictChart";

// "Name (U0ABC123)" -> "U0ABC123", the format actorName() stamps into
// review_audits.reviewer, mod_actions.actor, etc. across the dashboard.
export function slackIdFromLabel(label: string): string | null {
  const m = label.match(/\(([^()]+)\)\s*$/);
  return m ? m[1] : null;
}

export function emptyCounts(): VerdictCounts {
  return { approved: 0, firstPass: 0, changes: 0, rejected: 0 };
}

// Only the four verdicts a chart reader actually thinks of as "the outcome" -
// first_pass_needs_changes/first_pass_banned, sent_to_first_pass, unshipped,
// reverted, and hours_deflated are review-pipeline housekeeping, not a review
// verdict.
export function bucketFor(verdict: string): keyof VerdictCounts | null {
  if (verdict === "approved") return "approved";
  if (verdict === "first_pass_approved") return "firstPass";
  if (verdict === "needs_changes") return "changes";
  if (verdict === "banned") return "rejected";
  return null;
}

interface AuditLike {
  reviewer: string;
  verdict: string;
  created_at: string;
}

// Verdict counts plus how many distinct reviewers submitted them, for one time
// window (`since` is a UTC ms timestamp, null = all time). A reviewer is keyed
// by Slack id when the label has one (so a renamed "Name (ID)" label is still
// one person) and counts only if they submitted a bucketed outcome verdict,
// so an unship or revert alone doesn't make someone an active reviewer.
export interface ReviewerCount {
  name: string;
  reviews: number;
}

// "Name (U0ABC123)" -> "Name" for display; the id stays out of the UI.
function displayName(label: string): string {
  return label.replace(/\s*\([^()]*\)\s*$/, "").trim() || label;
}

// `audits` is expected newest first (as the stats page queries it), so the
// first label seen for a Slack id is that reviewer's most recent name.
export function summarizeWindow(
  audits: AuditLike[],
  since: number | null,
): { counts: VerdictCounts; reviewers: number; reviewerList: ReviewerCount[] } {
  const counts = emptyCounts();
  const byReviewer = new Map<string, ReviewerCount>();
  for (const a of audits) {
    if (since !== null && new Date(a.created_at).getTime() < since) continue;
    const bucket = bucketFor(a.verdict);
    if (!bucket) continue;
    counts[bucket]++;
    const key = slackIdFromLabel(a.reviewer) ?? a.reviewer;
    const entry = byReviewer.get(key);
    if (entry) entry.reviews++;
    else byReviewer.set(key, { name: displayName(a.reviewer), reviews: 1 });
  }
  const reviewerList = [...byReviewer.values()].sort(
    (a, b) => b.reviews - a.reviews || a.name.localeCompare(b.name),
  );
  return { counts, reviewers: reviewerList.length, reviewerList };
}
