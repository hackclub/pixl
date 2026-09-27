-- Optional screenshot on a reviewer note (see 0195_project_notes.sql) - a
-- reviewer explaining "look at this" often needs to show it, not just
-- describe it. Uploaded through the same Hack Club CDN path as everything
-- else the dashboard uploads (uploadSubmissionImage in lib/gameServer.ts).
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE project_notes ADD COLUMN IF NOT EXISTS image_url text;
