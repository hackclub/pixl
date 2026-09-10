-- Optional super-admin QA pass over second-pass reviews (the dashboard's
-- Spot check tab, apps/dashboard/app/actions.ts's markSpotChecked). Purely
-- an audit tool - doesn't gate the project, a real second-pass verdict is
-- still required separately. Global once set (not per-admin): any super
-- checking a project dismisses it for every super.
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS spot_checked_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS spot_checked_by TEXT NOT NULL DEFAULT '';
