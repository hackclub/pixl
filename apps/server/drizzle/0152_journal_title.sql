-- Optional title for a journal entry, so a player can name what a session
-- was about instead of every entry being an untitled block of text.
--
-- Idempotent - safe to run again, IF NOT EXISTS guard.
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE project_journals ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
