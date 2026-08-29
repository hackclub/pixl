-- Super-admin-only "hold" on a project's review: the project still shows in
-- the queue, but its review page blocks submitting a verdict (first pass,
-- final pass, extend cutoff, send back, ban) while held, and shows why.
-- Any super admin can put a project on hold or take it off, not just the one
-- who set it, so a hold never gets stuck if that person is unavailable.
--
-- Idempotent - safe to run again, IF NOT EXISTS guards.
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS hold_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hold_by text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hold_reason text NOT NULL DEFAULT '';
