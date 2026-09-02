import { describe, expect, test } from "bun:test";
import { aiReviewCompletionPatch } from "./aiReviewQueue";

describe("aiReviewCompletionPatch", () => {
  test("sends a zero-score scan to the human reviewer queue", () => {
    const patch = aiReviewCompletionPatch(0);

    expect(patch.status).toBe("shipped");
    expect(patch.ai_review_status).toBe("completed");
    expect(patch.ai_review_score).toBe(0);
  });
});
