import { describe, expect, test } from "bun:test";
import { earnedProjectHours } from "./earnedProject";

const row = (over: Partial<Parameters<typeof earnedProjectHours>[0]> = {}) => ({
  status: "approved", is_update: false, prior_approved_hours: null,
  approved_hours: 10, hackatime_seconds: 36000, ...over,
});

describe("banked project hours", () => {
  test("approved projects count their currently approved hours", () => {
    expect(earnedProjectHours(row())).toBe(10);
    expect(earnedProjectHours(row({ approved_hours: 12 }))).toBe(12);
  });
  test("re-shipping an approved project preserves only previously approved work", () => {
    for (const status of ["shipped", "needs_changes", "fraud_review", "second_review"])
      expect(earnedProjectHours(row({ status, is_update: true, prior_approved_hours: 6, approved_hours: 25, hackatime_seconds: 150000 }))).toBe(6);
  });
  test("first-time submissions and drafts never bank unapproved hours", () => {
    for (const status of ["shipped", "needs_changes", "draft", "second_review"])
      expect(earnedProjectHours(row({ status, is_update: false, prior_approved_hours: null }))).toBeNull();
  });
  test("a banned project is excluded by the caller's banned_at filter", () => {
    expect(earnedProjectHours(row({ status: "shipped", is_update: true, prior_approved_hours: null }))).toBeNull();
  });
});
