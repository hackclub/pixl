import { describe, expect, test } from "bun:test";
import { redactStaffFields } from "./projects.js";

const STAFF_ONLY_FIELDS = [
  "ban_by",
  "ban_reason",
  "reviewing_by",
  "first_pass_by",
  "first_pass_note",
  "first_pass_verdict",
  "system_note",
  "review_note_by",
  "reject_by",
  "hold_by",
  "hold_reason",
  "spot_checked_by",
  "spot_checked_at",
  "review_draft",
  "review_draft_by",
  "review_draft_at",
  "airtable_record_id",
  "joe_project_id",
  "joe_submitted_at",
  "joe_trust_score",
  "joe_outcome",
  "joe_reason",
  "joe_reviewed_at",
  "joe_reviewer",
  "joe_error",
];

function fullRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    name: "my project",
    status: "shipped",
    review_note: "looks great, shipped it",
    reject_reason: "",
  };
  for (const field of STAFF_ONLY_FIELDS) row[field] = `secret-${field}`;
  return row;
}

describe("redactStaffFields", () => {
  test("strips every staff-only field", () => {
    const redacted = redactStaffFields(fullRow());
    for (const field of STAFF_ONLY_FIELDS) expect(field in redacted).toBe(false);
  });

  test("keeps fields the player is meant to see, including the player-facing reason", () => {
    const redacted = redactStaffFields(fullRow());
    expect(redacted.id).toBe(1);
    expect(redacted.name).toBe("my project");
    expect(redacted.status).toBe("shipped");
    expect(redacted.review_note).toBe("looks great, shipped it");
    expect("reject_reason" in redacted).toBe(true);
  });

  test("a row with no staff fields set passes through unchanged", () => {
    const row = { id: 2, name: "draft", status: "draft" };
    expect(redactStaffFields(row)).toEqual(row);
  });
});
