-- Persistent, PIXL-only copy of the public Ships archive for the internal
-- fulfillment eligibility reader. The app writes a complete generation and
-- flips active_snapshot_id in one transaction. Failed or interrupted refreshes
-- cannot replace the previous active generation.
-- Apply explicitly with the normal server database migration process.

CREATE TABLE IF NOT EXISTS ships_snapshots (
  snapshot_id uuid PRIMARY KEY,
  fetched_at_ms bigint NOT NULL CHECK (fetched_at_ms >= 0),
  etag text,
  total_returned integer NOT NULL CHECK (total_returned >= 0),
  pixl_count integer NOT NULL CHECK (pixl_count >= 0),
  invalid_count integer NOT NULL CHECK (invalid_count >= 0),
  duplicate_count integer NOT NULL CHECK (duplicate_count >= 0),
  response_bytes integer NOT NULL CHECK (response_bytes >= 0),
  invalid_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(invalid_record_ids) = 'array'),
  ambiguous_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ambiguous_record_ids) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ships_snapshot_records (
  snapshot_id uuid NOT NULL REFERENCES ships_snapshots(snapshot_id) ON DELETE CASCADE,
  record_id text NOT NULL CHECK (record_id ~ '^rec[A-Za-z0-9]{14}$'),
  approved_at double precision CHECK (approved_at IS NULL OR approved_at >= 0),
  hours double precision NOT NULL CHECK (hours >= 0 AND hours < 'Infinity'::double precision),
  code_url text NOT NULL,
  repo_key text,
  github_username text NOT NULL,
  slack_id text,
  PRIMARY KEY (snapshot_id, record_id)
);

CREATE INDEX IF NOT EXISTS ships_snapshot_records_repo_idx
  ON ships_snapshot_records (snapshot_id, repo_key)
  WHERE repo_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ships_snapshot_records_github_idx
  ON ships_snapshot_records (snapshot_id, lower(github_username));

CREATE TABLE IF NOT EXISTS ships_snapshot_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_snapshot_id uuid REFERENCES ships_snapshots(snapshot_id),
  last_attempt_at_ms bigint,
  last_success_at_ms bigint,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_retry_at_ms bigint,
  last_duration_ms integer,
  refresh_token uuid,
  refresh_lease_until_ms bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ships_snapshot_state (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
