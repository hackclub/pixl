-- Post-approval hour correction from the project page (see
-- deflateProjectHours in apps/dashboard/app/actions.ts): an owner/super-admin
-- lowers an already-approved project's credited hours, e.g. after Hack Club
-- HQ flags an over-claim in the Unified YSWS Airtable base and Pixl risks a
-- fine for it. Distinct from project_journals.deflation_reason (a reviewer's
-- per-entry override made during first/second pass, see
-- 0178_journal_deflation_reason.sql) and from second_pass_hours_deflated (a
-- checklist box for a deflation made elsewhere during second pass). Mirrors
-- hours_extended_since/by/note below (same shape, opposite direction).
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS deflation_reason text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hours_deflated_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hours_deflated_by text NOT NULL DEFAULT '';
