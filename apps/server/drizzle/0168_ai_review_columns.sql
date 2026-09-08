-- Documents columns that already existed live on `projects` with no migration
-- record in this repo (found while building the AI-assisted review draft
-- feature). All IF NOT EXISTS - safe no-op against the current live DB,
-- this file just brings the repo's history in sync with reality.
--
-- Powers the "Generate AI draft" button on the review page (admin-only,
-- Claude Sonnet via OpenRouter - see apps/dashboard/lib/aiReview.ts): drafts
-- the technical-features/notes text for a reviewer to read and edit, never
-- a verdict or credited hours.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_status text NOT NULL DEFAULT 'disabled';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_score integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_summary text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_findings jsonb NOT NULL DEFAULT '{"findings": [], "strengths": []}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_error text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_started_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_model text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_revision text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_files_seen integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_review_files_omitted integer NOT NULL DEFAULT 0;
