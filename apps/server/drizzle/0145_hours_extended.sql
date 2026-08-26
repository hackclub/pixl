-- Lets a reviewer count Hackatime hours from before the global
-- hackatimeCutoff (2026-07-18) for one specific project, e.g. a big project
-- that was legitimately started earlier and paused. Recorded who did it, why,
-- and what "since" date they used, so it's auditable rather than a silent
-- edit of hackatime_seconds.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS hours_extended_since timestamptz,
  ADD COLUMN IF NOT EXISTS hours_extended_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hours_extended_note text NOT NULL DEFAULT '';
