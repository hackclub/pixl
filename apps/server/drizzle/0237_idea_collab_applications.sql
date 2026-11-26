CREATE TABLE IF NOT EXISTS idea_collab_applications (
  idea_id bigint NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
