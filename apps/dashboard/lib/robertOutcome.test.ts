import { describe, expect, test } from "bun:test";
import { reviewPatch, isFraudRangeScore, FRAUD_SCORE_THRESHOLD } from "./robertOutcome";

const clean = {
  trustScore: 8,
  note: "Steady heartbeats, commits match the editor activity.",
  reviewedAt: "2026-08-15T12:00:00.000Z",
  robertState: "awaiting_outcome",
};

const fraudRange = {
  trustScore: 2,
  note: "Reused someone else's repo.",
  reviewedAt: "2026-08-15T12:00:00.000Z",
  robertState: "rejected_fraud",
};

describe("isFraudRangeScore", () => {
  test("matches Robert's own Fraud band (1-4)", () => {
    expect(isFraudRangeScore(1)).toBe(true);
    expect(isFraudRangeScore(FRAUD_SCORE_THRESHOLD)).toBe(true);
    expect(isFraudRangeScore(FRAUD_SCORE_THRESHOLD + 1)).toBe(false);
    expect(isFraudRangeScore(10)).toBe(false);
  });
});

describe("reviewPatch", () => {
  test("parks a clean score straight into Spot check as not_fraud", () => {
    const patch = reviewPatch("fraud_review", clean)!;
    expect(patch.status).toBe("second_review");
    expect(patch.second_pass_verdict).toBe("not_fraud");
    expect(patch.second_pass_by).toBe("Robert");
    expect(patch.robert_trust_score).toBe(8);
    expect(patch.robert_note).toBe(clean.note);
    expect(patch.robert_state).toBe("awaiting_outcome");
  });

  test("a fraud-range score still parks into Spot check as not_fraud, not a ban", () => {
    const patch = reviewPatch("fraud_review", fraudRange)!;
    expect(patch.status).toBe("second_review");
    expect(patch.second_pass_verdict).toBe("not_fraud");
    expect(patch.robert_trust_score).toBe(2);
    expect(patch.robert_state).toBe("rejected_fraud");
  });

  test("clears any stored submission error", () => {
    expect(reviewPatch("fraud_review", clean)!.robert_error).toBe("");
  });

  test("does nothing for a project not parked waiting on Robert", () => {
    expect(reviewPatch("second_review", clean)).toBeNull();
    expect(reviewPatch("approved", clean)).toBeNull();
    expect(reviewPatch("needs_changes", clean)).toBeNull();
    expect(reviewPatch("shipped", clean)).toBeNull();
  });

  test("rejects a non-finite trust score", () => {
    expect(reviewPatch("fraud_review", { ...clean, trustScore: NaN })).toBeNull();
  });
});
