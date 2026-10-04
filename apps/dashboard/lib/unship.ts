// What a reviewer-side unship resets on a project (see unshipProject in
// app/actions.ts). The player-side unship (apps/server routes/projects.ts) only
// runs on "shipped" because it leaves first_pass_* behind; this one is only
// reachable by a final reviewer at second_review, so it has to wipe every
// review field - a stale first_pass_verdict (say, a ban proposal) surviving a
// reship is exactly the bug that restriction exists to prevent.
export function unshipResetFields() {
  return {
    status: "draft",
    shipped_at: null,
    review_note: "",
    review_note_by: "",
    approved_hours: null,
    reviewing_by: "",
    reviewing_at: null,
    first_pass_by: "",
    first_pass_at: null,
    first_pass_note: "",
    first_pass_hours: null,
    first_pass_verdict: null,
    spot_checked_at: null,
    spot_checked_by: "",
    second_pass_by: "",
    second_pass_at: null,
    second_pass_note: "",
    second_pass_hours: null,
    second_pass_verdict: null,
    second_pass_telescreen_checked: false,
    second_pass_hours_deflated: false,
    second_pass_heartbeats_added: false,
    review_draft: null,
    review_draft_by: "",
    review_draft_at: null,
    reverted_at: null,
  };
}
