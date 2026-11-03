import { describe, expect, test } from "bun:test";
import type { EligibilityResult, EligibilityStatus } from "./engine";
import { listSummary } from "./format";

const result = (status: EligibilityStatus, afterCents: number): EligibilityResult => ({
  status,
  verification: "verified",
  verifiedHours: 12.9,
  afterCents,
} as EligibilityResult);

describe("fulfillment list summaries", () => {
  test("never presents a positive balance as ready if restricted", () => {
    expect(listSummary(result("restricted", 779))).toBe("Restriction blocks fulfillment");
  });

  test("treats review and missing verification as requiring attention", () => {
    expect(listSummary(result("review_required", 779))).toBe("Policy review required");
    expect(listSummary(result("unverified", 779))).toBe("Funding not established");
    expect(listSummary(null)).toBe("Evidence unavailable");
  });

  test("keeps verified shortfalls and balances visible", () => {
    expect(listSummary(result("insufficient", -250))).toBe("12.9h · short $2.50");
    expect(listSummary(result("covered", 779))).toBe("12.9h · $7.79 left");
  });
});
