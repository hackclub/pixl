// What a scored review from Robert does to a project, shared by the webhook
// and the reconcile cron so the two can never drift. Deliberately free of
// any database import so it stays a pure unit under test.

// Robert's own "Fraud" band (its docs: 1-4 is "Fraud! Fraud! Fraud!"). A
// score in this range still goes to Spot check like every other reviewed
// project - it just also gets an alert, see robertSync.ts.
export const FRAUD_SCORE_THRESHOLD = 4;

export function isFraudRangeScore(trustScore: number): boolean {
  return trustScore <= FRAUD_SCORE_THRESHOLD;
}

export interface IncomingReview {
  trustScore: number;
  note: string;
  reviewedAt: string;
  // Robert's own state at the moment this review was read: "awaiting_outcome"
  // (score > 4, nobody has decided yet) or "rejected_fraud" (score <= 4,
  // already final on Robert's side - the outcome write-back must skip these).
  robertState: string;
}

export interface ReviewPatch {
  status: "second_review";
  second_pass_by: "Robert";
  second_pass_at: string;
  second_pass_note: string;
  second_pass_hours: null;
  second_pass_verdict: "not_fraud";
  robert_trust_score: number;
  robert_note: string;
  robert_reviewed_at: string;
  robert_state: string;
  robert_error: "";
}

// Returns null when there's nothing to apply: no real score, or the project
// isn't (or isn't anymore) parked waiting on Robert - a replayed delivery,
// or one that lost the race to a re-ship, must never drag an already-moved
// project backwards. Robert's own fraud score is the fraud determination
// now (no more human triage), so every real score parks straight into Spot
// check as not_fraud regardless of the score - a low score only adds an
// alert (see maybeAlertFraudScore in robertSync.ts), it never bans directly.
export function reviewPatch(
  currentStatus: string,
  review: IncomingReview,
): ReviewPatch | null {
  if (currentStatus !== "fraud_review") return null;
  if (!Number.isFinite(review.trustScore)) return null;
  return {
    status: "second_review",
    second_pass_by: "Robert",
    second_pass_at: new Date().toISOString(),
    second_pass_note: review.note,
    second_pass_hours: null,
    second_pass_verdict: "not_fraud",
    robert_trust_score: review.trustScore,
    robert_note: review.note,
    robert_reviewed_at: review.reviewedAt,
    robert_state: review.robertState,
    robert_error: "",
  };
}
