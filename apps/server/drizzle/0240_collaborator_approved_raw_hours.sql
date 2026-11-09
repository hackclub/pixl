-- Prevent re-crediting hours rejected on a collaborator's previous ship.
-- The owner's most recently approved raw claim is recorded in immutable
-- review_audits.claimed_hours; collaborators need their OWN equivalent snapshot.
-- Migration is additive and safe to reapply before deploying the code.
ALTER TABLE project_collaborators
  ADD COLUMN IF NOT EXISTS last_approved_claimed_hours numeric(10, 2);

-- For already-approved collaborations, the last ship's Hackatime snapshot has
-- not been overwritten by a later reship. If the collaborator used journals
-- only, use the current raw journal total conservatively. Pending update
-- reviews with no reliable old baseline are intentionally NOT backfilled:
-- the reviewer must reconcile their prior evidence instead of guessing.
UPDATE project_collaborators c
SET last_approved_claimed_hours = CASE
  WHEN COALESCE(c.hackatime_seconds, 0) > 0
    THEN ROUND(c.hackatime_seconds::numeric / 3600, 1)
  ELSE COALESCE((
    SELECT ROUND(SUM(j.hours::numeric), 1)
    FROM project_journals j
    WHERE j.project_id = c.project_id AND j.user_id = c.user_id
  ), 0)
END
FROM projects p
WHERE p.id = c.project_id
  AND p.status = 'approved'
  AND c.approved_hours IS NOT NULL
  AND c.last_approved_claimed_hours IS NULL;
