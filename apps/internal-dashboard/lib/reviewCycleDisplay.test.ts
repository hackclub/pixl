import { describe, expect, test } from "bun:test";
import { hasCurrentFirstPass, currentFirstPassAt } from "./reviewCycleDisplay";

describe("first pass UI is scoped to the current review cycle", () => {
  test("an approved project's pending update must not show its old reviewer or completed step", () => {
    expect(hasCurrentFirstPass({ status: "shipped", first_pass_by: "Old reviewer" })).toBe(false);
    expect(currentFirstPassAt("shipped", "2026-09-23T00:00:00Z")).toBeNull();
  });
  test("the actual first-pass reviewer appears in subsequent stages", () => {
    for (const status of ["fraud_review", "second_review", "approved"]) {
      expect(hasCurrentFirstPass({ status, first_pass_by: "New reviewer" })).toBe(true);
      expect(currentFirstPassAt(status, "2026-11-05T08:00:00Z")).toBe("2026-11-05T08:00:00Z");
    }
  });
  test("no reviewer appears before a first-pass verdict", () => {
    expect(hasCurrentFirstPass({ status: "shipped", first_pass_by: "" })).toBe(false);
    expect(hasCurrentFirstPass({ status: "second_review", first_pass_by: "" })).toBe(false);
  });
});
