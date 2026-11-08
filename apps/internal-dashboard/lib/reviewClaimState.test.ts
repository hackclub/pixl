import { describe, expect, test } from "bun:test";
import { activeReviewClaim } from "./reviewClaimState";

const NOW = Date.parse("2026-11-08T15:00:00Z");
const LOCK_MS = 30 * 60_000;

describe("active review claims", () => {
  test("no claim for a project opened only for inspection", () => {
    expect(activeReviewClaim({ reviewing_by: "", reviewing_at: null }, NOW, LOCK_MS)).toBeNull();
  });

  test("recognizes an explicit fresh review claim", () => {
    expect(activeReviewClaim({ reviewing_by: "U_REVIEWER", reviewing_at: new Date(NOW - 60_000).toISOString() }, NOW, LOCK_MS)).toBe("U_REVIEWER");
  });

  test("expires claims at exactly thirty minutes", () => {
    expect(activeReviewClaim({ reviewing_by: "U_REVIEWER", reviewing_at: new Date(NOW - LOCK_MS).toISOString() }, NOW, LOCK_MS)).toBeNull();
  });

  test("ignores missing, malformed and future timestamps", () => {
    expect(activeReviewClaim({ reviewing_by: "U", reviewing_at: null }, NOW, LOCK_MS)).toBeNull();
    expect(activeReviewClaim({ reviewing_by: "U", reviewing_at: "garbage" }, NOW, LOCK_MS)).toBeNull();
    expect(activeReviewClaim({ reviewing_by: "U", reviewing_at: new Date(NOW + 3000).toISOString() }, NOW, LOCK_MS)).toBeNull();
  });
});
