ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_review_status text NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS ai_review_score integer,
  ADD COLUMN IF NOT EXISTS ai_review_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_review_findings jsonb NOT NULL DEFAULT '{"strengths": [], "findings": []}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_review_error text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_review_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_review_model text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_review_revision text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_review_files_seen integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_review_files_omitted integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS projects_ai_review_queue_idx
  ON projects (ai_review_status, ai_review_started_at)
  WHERE status = 'ai_review';
