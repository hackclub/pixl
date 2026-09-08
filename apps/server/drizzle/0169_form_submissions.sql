-- Public, no-account forms (e.g. pixl.hackclub.com/form/review, a reviewer
-- recruitment form). Submitters verify their real Slack identity via Hack
-- Club Auth (see apps/web-shell/app/form's auth flow) but never get a Pixl
-- player account - this table is the only record of them. form_key keeps
-- this generic for future forms, not just "review".
--
-- Idempotent. Run against the orchard/CNPG database.

CREATE TABLE IF NOT EXISTS form_submissions (
  id SERIAL PRIMARY KEY,
  form_key TEXT NOT NULL,
  slack_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  -- SHA-256 of the submitter's IP, not the raw address - enough to rate-limit
  -- and spot abuse without storing PII we don't need.
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE form_submissions DROP CONSTRAINT IF EXISTS form_submissions_status_check;
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_key ON form_submissions(form_key, status);
CREATE INDEX IF NOT EXISTS idx_form_submissions_slack_id ON form_submissions(slack_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created_at ON form_submissions(created_at);
