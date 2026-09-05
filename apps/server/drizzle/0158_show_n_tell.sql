-- Show & Tell: a genuine one-account-one-vote voting system for a live
-- show-and-tell event, replacing form-based voting (easy to ballot-stuff)
-- with votes tied to real logged-in Pixl accounts. A "round" is one event
-- (opened/closed by a CT member with the show_n_tell permission); its
-- entries point at existing shipped projects rather than duplicating
-- project data; votes are one per (entry, user) - a player can upvote as
-- many entries as they like, but only once each.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

CREATE TABLE IF NOT EXISTS show_n_tell_rounds (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT false,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one round open at a time - enforced with a partial unique index
-- rather than application logic alone, so a race can't open two at once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_show_n_tell_rounds_one_open
  ON show_n_tell_rounds ((is_open))
  WHERE is_open;

CREATE TABLE IF NOT EXISTS show_n_tell_entries (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES show_n_tell_rounds(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_show_n_tell_entries_round ON show_n_tell_entries(round_id);

CREATE TABLE IF NOT EXISTS show_n_tell_votes (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES show_n_tell_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_show_n_tell_votes_entry ON show_n_tell_votes(entry_id);
CREATE INDEX IF NOT EXISTS idx_show_n_tell_votes_user ON show_n_tell_votes(user_id);
