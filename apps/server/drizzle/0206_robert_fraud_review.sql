-- Replaces the Joe fraud-review integration (0122_joe_fraud_review.sql) with
-- Robert (telescreen.hackclub.com), Joe's successor - Joe was only ever live
-- briefly (59 submissions, 6 real outcomes, now fully retired) and its
-- outcome was advisory only, leaving a human to still do fraud/not_fraud
-- triage afterward. Robert's own fraud reviewer IS the fraud determination
-- now - there is no more human fraud-triage step (see FraudTriageForm's
-- removal), so its review lands directly as second_pass_verdict='not_fraud'
-- and the project moves straight to Spot check, carrying Robert's trust
-- score and note for the super to see. A trust score in Robert's own
-- "Fraud" range (<=4) still goes to Spot check rather than being treated as
-- a final rejection on Pixl's side - it just also alerts the owners.
--
-- robert_project_id: Robert's uuid for this submission.
-- robert_submitted_at: when we successfully posted it to Robert.
-- robert_trust_score: Robert's fraud reviewer score, 1-10.
-- robert_note: the fraud reviewer's note (Robert's review.note).
-- robert_reviewed_at: when Robert's fraud reviewer scored it.
-- robert_state: Robert's own project state at last sync (awaiting_review /
--   awaiting_outcome / rejected_fraud / decided) - lets the Spot check
--   outcome write-back skip calling Robert's outcome endpoint on a project
--   Robert already finalized itself (rejected_fraud), which would 409.
-- robert_outcome / robert_outcome_at: the decision Pixl recorded back to
--   Robert (approved/rejected) once Spot check finalizes, so Robert's own
--   record stays accurate too.
-- robert_error: a failed submission's error, for the reconcile cron to retry.
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS robert_project_id text,
  ADD COLUMN IF NOT EXISTS robert_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS robert_trust_score integer,
  ADD COLUMN IF NOT EXISTS robert_note text,
  ADD COLUMN IF NOT EXISTS robert_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS robert_state text,
  ADD COLUMN IF NOT EXISTS robert_outcome text,
  ADD COLUMN IF NOT EXISTS robert_outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS robert_error text DEFAULT '';

ALTER TABLE projects
  DROP COLUMN IF EXISTS joe_project_id,
  DROP COLUMN IF EXISTS joe_submitted_at,
  DROP COLUMN IF EXISTS joe_trust_score,
  DROP COLUMN IF EXISTS joe_outcome,
  DROP COLUMN IF EXISTS joe_reason,
  DROP COLUMN IF EXISTS joe_reviewed_at,
  DROP COLUMN IF EXISTS joe_reviewer,
  DROP COLUMN IF EXISTS joe_error;

-- One-time backlog migration: every project currently sitting in the old
-- manual fraud-triage queue (second_review, untriaged, not a proposed ban)
-- moves into the new "awaiting Robert" parked state (fraud_review) instead
-- of staying actionable - manual fraud/not_fraud triage is retired as of
-- this migration, not just for projects shipped after it. They'll get
-- submitted to Robert (and drained into Spot check) by the reconcile cron
-- once ROBERT_API_KEY is configured.
UPDATE projects
SET status = 'fraud_review',
    second_pass_by = '',
    second_pass_at = NULL,
    second_pass_note = '',
    second_pass_hours = NULL,
    second_pass_verdict = NULL
WHERE status = 'second_review'
  AND second_pass_verdict IS NULL
  AND first_pass_verdict IS DISTINCT FROM 'banned';
