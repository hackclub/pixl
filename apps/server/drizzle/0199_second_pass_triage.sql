-- Second pass becomes a lighter fraud triage step: a reviewer picks
-- Fraud (bans immediately, same as the existing ban verdict) or Not fraud
-- (parks the project for a super to give the real final verdict in Spot
-- check), with a required note and optionally lower the credited hours -
-- exactly the same shape as first_pass_by/at/note/hours/verdict already
-- record for the first pass, just one stage later.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS second_pass_by text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS second_pass_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS second_pass_note text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS second_pass_hours numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS second_pass_verdict text;
