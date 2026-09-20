-- Slack ownership codes for public forms (routes/formVerification.ts).
-- code_hash is an HMAC, never the code. window_started_at/sends_in_window
-- are the DM send history and survive a consumed or exhausted code.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.form_verifications (
  key text PRIMARY KEY,
  code_hash text,
  name text NOT NULL DEFAULT '',
  expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL,
  window_started_at timestamptz NOT NULL,
  sends_in_window integer NOT NULL DEFAULT 0
);
