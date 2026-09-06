-- Lets a Show & Tell entry be a freeform name instead of always pointing at a
-- real projects row (e.g. someone demoing something live that was never
-- entered into Pixl as a project) - project_id becomes optional, and an entry
-- must have EITHER a real project_id OR a non-empty custom_name.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE show_n_tell_entries ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE show_n_tell_entries ADD COLUMN IF NOT EXISTS custom_name TEXT;

ALTER TABLE show_n_tell_entries DROP CONSTRAINT IF EXISTS show_n_tell_entries_has_project_or_name;
ALTER TABLE show_n_tell_entries ADD CONSTRAINT show_n_tell_entries_has_project_or_name
  CHECK (project_id IS NOT NULL OR (custom_name IS NOT NULL AND length(trim(custom_name)) > 0));
