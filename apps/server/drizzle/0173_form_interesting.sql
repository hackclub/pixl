-- "Mark as interesting" for the dashboard's Forms tab (apps/dashboard/app/forms) -
-- lets an admin keep a pending submission for later without deciding on it
-- yet. Doesn't touch status (still 'pending' until a real accept/reject),
-- just flags it into its own section and DMs the applicant that they cleared
-- a first pass with a second round to come.
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS interesting_at TIMESTAMPTZ;
ALTER TABLE form_submissions ADD COLUMN IF NOT EXISTS interesting_by TEXT NOT NULL DEFAULT '';
