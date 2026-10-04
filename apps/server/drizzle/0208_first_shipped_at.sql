-- The date a project was FIRST shipped for review. shipped_at is refreshed on
-- every ship (a fix-and-reship after needs_changes, an update to an approved
-- project), so it only shows how long the project has waited since its latest
-- ship. first_shipped_at is set once, on the first ship, and never reset, so the
-- review table can show the total time a maker has been waiting.
--
-- Backfill: shipped_at, or the earliest review audit if that is older (an audit
-- from before the current shipped_at proves an earlier ship). Projects that were
-- reshipped before any review was recorded can't be recovered and keep shipped_at.
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS first_shipped_at timestamptz;

UPDATE projects p
SET first_shipped_at = LEAST(
  p.shipped_at,
  COALESCE((SELECT MIN(a.created_at) FROM review_audits a WHERE a.project_id = p.id), p.shipped_at)
)
WHERE p.first_shipped_at IS NULL
  AND p.shipped_at IS NOT NULL;
