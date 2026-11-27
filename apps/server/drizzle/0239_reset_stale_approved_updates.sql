-- One-time repair for already-approved projects reshipped for additional hours.
-- The old first/second pass and Robert verdict are current-cycle columns, but
-- older ship code left them populated. The permanent fix is in projects.ts.
--
-- This backfill is intentionally narrower than the runtime reset:
-- - only first-pass rows still waiting for review, with proof their first-pass
--   verdict predates their latest ship;
-- - never touch a needs-changes reservation or a project with a new verdict;
-- - preserve review_audits, approved_hours, prior_approved_hours, payouts,
--   historical first_shipped_at and active reviewing_by/reviewing_at claims;
-- - preserve a new review_draft written after the latest ship.
-- Rerunning it is harmless once the old first_pass_at is cleared.

UPDATE public.projects AS p
SET
  first_pass_by = '',
  first_pass_at = NULL,
  first_pass_note = '',
  first_pass_hours = NULL,
  first_pass_verdict = NULL,
  second_pass_by = '',
  second_pass_at = NULL,
  second_pass_note = '',
  second_pass_hours = NULL,
  second_pass_verdict = NULL,
  second_pass_telescreen_checked = FALSE,
  second_pass_hours_deflated = FALSE,
  second_pass_heartbeats_added = FALSE,
  spot_checked_at = NULL,
  spot_checked_by = '',
  robert_project_id = NULL,
  robert_submitted_at = NULL,
  robert_trust_score = NULL,
  robert_note = NULL,
  robert_reviewed_at = NULL,
  robert_state = NULL,
  robert_outcome = NULL,
  robert_outcome_at = NULL,
  robert_error = ''
WHERE p.status = 'shipped'
  AND p.is_update = TRUE
  AND p.shipped_at IS NOT NULL
  AND p.first_pass_at IS NOT NULL
  AND p.first_pass_at < p.shipped_at
  AND p.first_pass_verdict = 'approved'
  AND COALESCE(p.assigned_reviewer_slack_id, '') = ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.review_audits AS a
    WHERE a.project_id = p.id
      AND a.created_at >= p.shipped_at
      AND a.verdict IN (
        'needs_changes', 'first_pass_approved', 'first_pass_banned',
        'first_pass_needs_changes', 'approved', 'banned'
      )
  );
