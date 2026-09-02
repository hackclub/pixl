export type AiReviewCompletionPatch = {
  readonly status: "shipped";
  readonly ai_review_status: "completed";
  readonly ai_review_score: number;
};

export function aiReviewCompletionPatch(score: number): AiReviewCompletionPatch {
  return {
    status: "shipped",
    ai_review_status: "completed",
    ai_review_score: score,
  };
}
