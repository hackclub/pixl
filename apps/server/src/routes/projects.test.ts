import { describe, expect, test } from "bun:test";
import { toPlayerProject } from "./projects.js";

// Every internal/admin column found on `projects` across drizzle/*.sql as of
// this test - reviewer/admin identities, fraud/system notes, review draft
// metadata, and the ai_review_* block. New columns must be added to the
// PLAYER_PROJECT_FIELDS allowlist in projects.ts before they can appear in a
// player response at all, so this list is a regression net, not the only
// thing keeping these fields out.
const INTERNAL_ONLY_FIELDS = [
  "ban_by",
  "ban_reason",
  "reviewing_by",
  "reviewing_at",
  "first_pass_by",
  "first_pass_at",
  "first_pass_note",
  "first_pass_verdict",
  "system_note",
  "review_note_by",
  "reject_by",
  "hold_by",
  "hold_at",
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
  "ai_review_status",
  "ai_review_score",
  "ai_review_summary",
  "ai_review_findings",
  "ai_review_error",
  "ai_review_started_at",
  "ai_reviewed_at",
  "ai_review_model",
  "ai_review_revision",
  "ai_review_files_seen",
  "ai_review_files_omitted",
  "second_pass_telescreen_checked",
  "second_pass_hours_deflated",
  "second_pass_heartbeats_added",
  "hours_extended_by",
  "hours_extended_note",
  "imported_ysws_entry_id",
  "imported_from_ysws",
  "imported_ysws_hours",
  "imported_ysws_approved_at",
  "imported_unshipped_source",
  "imported_unshipped_ref",
  "journal_share_token",
  "funding_deducted_px",
  "trial_prize_order_id",
];

function fullRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    name: "my project",
    status: "shipped",
    review_note: "looks great, shipped it",
    reject_reason: "",
    approved_hours: 12,
    first_pass_hours: 10,
    ...overrides,
  };
  for (const field of INTERNAL_ONLY_FIELDS) row[field] = `secret-${field}`;
  return row;
}

describe("toPlayerProject", () => {
  test("strips every known internal/admin column", () => {
    const safe = toPlayerProject(fullRow());
    for (const field of INTERNAL_ONLY_FIELDS) expect(field in safe).toBe(false);
  });

  test("drops a column that isn't on the allowlist at all, known or not", () => {
    const safe = toPlayerProject(fullRow({ some_future_admin_column: "secret" }));
    expect("some_future_admin_column" in safe).toBe(false);
  });

  test("keeps fields the player is meant to see, including the player-facing reason", () => {
    const safe = toPlayerProject(fullRow());
    expect(safe.id).toBe(1);
    expect(safe.name).toBe("my project");
    expect(safe.status).toBe("shipped");
    expect(safe.review_note).toBe("looks great, shipped it");
    expect("reject_reason" in safe).toBe(true);
  });

  // The project page counts Hackatime hours from this date, the reviewer's
  // name and note behind it stay internal.
  test("keeps the extended hours cutoff date but not who set it or why", () => {
    const safe = toPlayerProject(fullRow({ hours_extended_since: "2026-01-01T00:00:00.000Z" }));
    expect(safe.hours_extended_since).toBe("2026-01-01T00:00:00.000Z");
    expect("hours_extended_by" in safe).toBe(false);
    expect("hours_extended_note" in safe).toBe(false);
  });

  test("hides approved_hours and first_pass_hours unless status is approved", () => {
    for (const status of ["draft", "shipped", "needs_changes", "second_review", "fraud_review"]) {
      const safe = toPlayerProject(fullRow({ status }));
      expect(safe.approved_hours).toBeNull();
      expect(safe.first_pass_hours).toBeNull();
    }
  });

  test("shows approved_hours and first_pass_hours once status is approved", () => {
    const safe = toPlayerProject(fullRow({ status: "approved" }));
    expect(safe.approved_hours).toBe(12);
    expect(safe.first_pass_hours).toBe(10);
  });

  test("a stale approved/first-pass value from a prior review cycle doesn't survive a needs_changes reset", () => {
    // The exact shape a needs_changes verdict leaves behind: hours from the
    // prior pass still sitting on the row while status has moved off "approved".
    const safe = toPlayerProject(
      fullRow({ status: "needs_changes", approved_hours: 8, first_pass_hours: 6 }),
    );
    expect(safe.approved_hours).toBeNull();
    expect(safe.first_pass_hours).toBeNull();
  });

  test("a row with no internal fields set still only returns allowlisted keys", () => {
    const safe = toPlayerProject({ id: 2, name: "draft", status: "draft" });
    expect(safe.id).toBe(2);
    expect(safe.name).toBe("draft");
    expect(safe.status).toBe("draft");
    expect(safe.approved_hours).toBeNull();
  });
});
