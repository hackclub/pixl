import { describe, expect, test } from "bun:test";
import { parseAiReviewResponse } from "./aiReview";

describe("parseAiReviewResponse", () => {
  test("clamps the score and keeps only bounded advisory findings", () => {
    const result = parseAiReviewResponse(
      {
        score: 140,
        summary: "A polished project with a ghp_1234567890abcdef token.",
        strengths: ["Clear README", 42],
        findings: [
          {
            category: "code",
            severity: "high",
            title: "Large change",
            evidence: "owner@example.com appears in a fixture",
          },
        ],
      },
      { model: "test-model", revision: "abc123", filesSeen: 4, filesOmitted: 1 },
    );

    expect(result.score).toBe(100);
    expect(result.summary).toContain("[redacted]");
    expect(result.strengths).toEqual(["Clear README"]);
    expect(result.findings[0]?.severity).toBe("high");
    expect(result.findings[0]?.evidence).toContain("[redacted]");
    expect(result.model).toBe("test-model");
  });

  test("rejects a response without a finite score", () => {
    expect(() =>
      parseAiReviewResponse(
        { summary: "No score" },
        { model: "test-model", revision: "abc123", filesSeen: 0, filesOmitted: 0 },
      ),
    ).toThrow("AI review response did not contain a score");
  });
});
