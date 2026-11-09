// A fully approved project's next ship is a NEW review cycle, not a
// "requested changes" resubmission. Keep past reviews in review_audits and
// cumulative credited hours on the project; clear only current-cycle state.
export function approvedUpdateReviewResetFields() {
  return {
    reviewing_by: "",
    reviewing_at: null,
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
    second_pass_telescreen_checked: false,
    second_pass_hours_deflated: false,
    second_pass_heartbeats_added: false,
    spot_checked_at: null,
    spot_checked_by: "",
    review_draft: null,
    review_draft_by: "",
    review_draft_at: null,
    assigned_reviewer_slack_id: "",
    assigned_at: null,
    assignment_reminded_at: null,
    // Robert's score/outcome belongs to the last approved ship.
    // Its new review will receive its own external ID and fraud decision.
    robert_project_id: null,
    robert_submitted_at: null,
    robert_trust_score: null,
    robert_note: null,
    robert_reviewed_at: null,
    robert_state: null,
    robert_outcome: null,
    robert_outcome_at: null,
    robert_error: "",
  };
}

/** Reshipping requested changes to an APPROVED project's update must keep
 * is_update and the already banked approval. Only the first approved -> shipped
 * transition clears the review cycle and freezes new prior_approved_hours.
 */
export function approvedUpdateShipState(project: {
  status: string;
  is_update?: boolean | null;
  rejected_at?: string | null;
}): { startsUpdate: boolean; isUpdate: boolean } {
  const startsUpdate = project.status === "approved" && !project.rejected_at;
  return {
    startsUpdate,
    isUpdate: startsUpdate || (project.status === "needs_changes" && project.is_update === true),
  };
}
