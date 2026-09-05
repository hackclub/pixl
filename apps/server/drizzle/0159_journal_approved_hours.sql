-- Lets a reviewer deflate a single journal entry directly from the Journals
-- tab instead of only being able to set one blanket "Credited hours" number
-- for the whole project. NULL means "use the player's own claimed hours for
-- this entry, unchanged" - the column is an override, not a duplicate value.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE project_journals ADD COLUMN IF NOT EXISTS approved_hours NUMERIC;
