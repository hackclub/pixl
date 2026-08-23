-- Stores the Airtable record ID once a reviewer pushes an approved project to
-- the intermediate "YSWS Project Submission" base, so a second push updates
-- the existing row (PATCH) instead of creating a duplicate. Nothing else
-- reads or writes this column automatically - it's set only by
-- sendProjectToAirtable in apps/dashboard/app/actions.ts.
--
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "airtable_record_id" text;
