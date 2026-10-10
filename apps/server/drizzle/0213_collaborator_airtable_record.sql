-- One Airtable row per person on a project, not just the owner. The owner's row
-- id lives in projects.airtable_record_id; each accepted collaborator's lives
-- here, so re-sending a project to Airtable updates their own row instead of
-- creating a duplicate (and so an update ship, which clears these, starts them
-- fresh, same rule as the owner's - see the ship route in routes/projects.ts).
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE project_collaborators ADD COLUMN IF NOT EXISTS airtable_record_id text;
