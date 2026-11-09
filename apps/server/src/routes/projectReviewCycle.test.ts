import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { approvedUpdateReviewResetFields, approvedUpdateShipState } from "./projectReviewCycle.js";

describe("approved project update review cycle", () => {
  test("erases the old reviewer's visible first pass and the old second pass", () => {
    const fields = approvedUpdateReviewResetFields();
    expect(fields).toMatchObject({
      first_pass_by: "",
      first_pass_at: null,
      first_pass_note: "",
      first_pass_hours: null,
      first_pass_verdict: null,
      second_pass_by: "",
      second_pass_at: null,
      second_pass_note: "",
      second_pass_hours: null,
      second_pass_verdict: null,
      spot_checked_at: null,
      spot_checked_by: "",
    });
  });

  test("does not carry over Robert, claim, review draft or old assignment", () => {
    const fields = approvedUpdateReviewResetFields();
    expect(fields).toMatchObject({
      robert_project_id: null,
      robert_submitted_at: null,
      robert_trust_score: null,
      robert_state: null,
      robert_outcome: null,
      reviewing_by: "",
      reviewing_at: null,
      review_draft: null,
      review_draft_by: "",
      review_draft_at: null,
      assigned_reviewer_slack_id: "",
      assigned_at: null,
      assignment_reminded_at: null,
      second_pass_telescreen_checked: false,
      second_pass_hours_deflated: false,
      second_pass_heartbeats_added: false,
    });
  });

  test("keeps credited hours and historic review evidence untouched", () => {
    const old = {
      status: "approved", approved_hours: 13.5, prior_approved_hours: 7.5,
      first_shipped_at: "2026-09-01T10:00:00Z", airtable_record_id: "old-record",
      first_pass_by: "U_OLD", first_pass_at: "2026-09-02T10:00:00Z",
      robert_project_id: "old-robert",
    };
    const next = { ...old, status: "shipped", ...approvedUpdateReviewResetFields() };
    expect(next.first_pass_by).toBe("");
    expect(next.first_pass_at).toBeNull();
    expect(next.robert_project_id).toBeNull();
    expect(next.approved_hours).toBe(13.5);
    expect(next.prior_approved_hours).toBe(7.5);
    expect(next.first_shipped_at).toBe(old.first_shipped_at);
    const fields = approvedUpdateReviewResetFields() as Record<string, unknown>;
    for (const name of ["approved_hours", "prior_approved_hours", "first_shipped_at", "review_audits", "funding_deducted_px"]) {
      expect(Object.hasOwn(fields, name)).toBe(false);
    }
  });

  test("only fully approved updates use this reset, not requested-changes reships", () => {
    const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    expect(source).toContain("const { startsUpdate, isUpdate } = approvedUpdateShipState(project");
    expect(source).toContain("...(startsUpdate ? approvedUpdateReviewResetFields() : {}),");
    expect(source).toContain('if (project.status === "needs_changes" && project.notify_reviewer_slack_id)');
  });
  test("preserves update status and previously banked RE on needs_changes reship", () => {
    expect(approvedUpdateShipState({ status: "approved", is_update: false })).toEqual({ startsUpdate: true, isUpdate: true });
    expect(approvedUpdateShipState({ status: "needs_changes", is_update: true })).toEqual({ startsUpdate: false, isUpdate: true });
    expect(approvedUpdateShipState({ status: "needs_changes", is_update: false })).toEqual({ startsUpdate: false, isUpdate: false });
    expect(approvedUpdateShipState({ status: "draft", is_update: false })).toEqual({ startsUpdate: false, isUpdate: false });
  });

  test("reshipping an update does not reset its originally banked hours, collaborator baselines or review claim", () => {
    const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");
    expect(source).toContain("...(startsUpdate ? { prior_approved_hours:");
    expect(source).toContain("...(startsUpdate ? { airtable_record_id: null } : {}),");
    expect(source).toContain("if (startsUpdate) {\\n    const { error: collabResetError }");
    expect(source).toContain("sidequest_id: isUpdate ? project.sidequest_id : sidequestId,");
  });
});
