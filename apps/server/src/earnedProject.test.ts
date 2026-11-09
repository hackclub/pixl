import { describe, expect, test } from "bun:test";
import { earnedProjectHours, earnedCollaboratorHours, mustPreserveApprovedProjectTerms } from "./earnedProject";

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

describe("lock previously approved project payout terms", () => {
  test("new projects can still choose a tier and a Trial", () => {
    for (const status of ["draft", "needs_changes", "shipped"]) {
      expect(mustPreserveApprovedProjectTerms(status, false)).toBe(false);
    }
  });

  test("all update review states retain the original tier and Trial link", () => {
    expect(mustPreserveApprovedProjectTerms("approved", false)).toBe(true);
    for (const status of ["shipped", "needs_changes", "second_review", "fraud_review", "approved", "draft"]) {
      expect(mustPreserveApprovedProjectTerms(status, true)).toBe(true);
    }
  });

  test("banked hours in needs_changes must not be regraded before reapproval", () => {
    const pending = row({ status: "needs_changes", is_update: true, prior_approved_hours: 20, approved_hours: 20 });
    expect(earnedProjectHours(pending)).toBe(20);
    expect(mustPreserveApprovedProjectTerms(pending.status, pending.is_update)).toBe(true);
  });
});

describe("approved collaborator hour banking", () => {
  const collab = (approved_hours: number | null, prior_approved_hours: number | null = null) =>
    ({ approved_hours, prior_approved_hours });

  test("approved collaborator earns their own hours, not owner hours", () => {
    expect(earnedCollaboratorHours({ status: "approved", is_update: false }, collab(6))).toBe(6);
    expect(earnedCollaboratorHours({ status: "approved", is_update: false }, collab(null))).toBe(0);
  });

  test("reship and needs_changes retain only the collaborator's previous approved hours", () => {
    for (const status of ["shipped", "needs_changes", "fraud_review", "second_review"]) {
      expect(earnedCollaboratorHours({ status, is_update: true }, collab(15, 6))).toBe(6);
    }
  });

  test("unapproved first ships and updates without a baseline earn nothing", () => {
    for (const status of ["draft", "shipped", "needs_changes", "fraud_review", "second_review"]) {
      expect(earnedCollaboratorHours({ status, is_update: false }, collab(15))).toBeNull();
    }
    expect(earnedCollaboratorHours({ status: "shipped", is_update: true }, collab(15))).toBeNull();
  });
});
