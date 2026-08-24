-- Notes describing what changed since a project's disclosed submission to
-- another Hack Club YSWS, shown to reviewers next to the "Other YSWS
-- disclosed" badge. Parallel to update_notes (0013_ship_extras.sql), but for
-- an update relative to another program's submission rather than a prior
-- Pixl approval.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS other_ysws_notes text NOT NULL DEFAULT '';
