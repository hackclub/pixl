-- Review page filters mod_actions by user_id; only the primary key existed.
-- Apply explicitly with the normal server database migration process.

CREATE INDEX IF NOT EXISTS mod_actions_user_created_idx
  ON mod_actions (user_id, created_at DESC);
