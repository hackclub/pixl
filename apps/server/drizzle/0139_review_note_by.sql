-- Tracks who left the current review_note, so the dashboard can show
-- "reviewer note (by X)" instead of an unattributed note.
--
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "review_note_by" text NOT NULL DEFAULT '';
