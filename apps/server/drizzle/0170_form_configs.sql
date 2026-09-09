-- Per-form settings for the public, no-account forms (pixl.hackclub.com/form/*,
-- see apps/server/src/routes/forms.ts). Lets the internal dashboard's Forms
-- tab edit a form's title/description/questions and set a close date without
-- a code change - apps/web-shell's form page reads this live.
--
-- Idempotent. Run against the orchard/CNPG database.

CREATE TABLE IF NOT EXISTS form_configs (
  form_key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Ordered array of {"key": "...", "label": "..."} - key is what shows up
  -- in form_submissions.answers and the dashboard, label is the question text.
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  close_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the one form that already exists in code so it isn't left unmanaged
-- after this migration (apps/web-shell/app/form/[formKey]/page.tsx's old
-- hardcoded copy). Only inserts if "review" isn't already there.
INSERT INTO form_configs (form_key, title, description, questions)
VALUES (
  'review',
  'Pixl reviewer application',
  'We''re looking for more reviewers to help keep the queue moving. Fill this out and we''ll get back to you.',
  '[{"key": "message", "label": "Why do you want to help review projects?"}]'::jsonb
)
ON CONFLICT (form_key) DO NOTHING;
