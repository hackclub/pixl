-- A free-text note the builder can attach at ship time for the reviewer -
-- context that doesn't fit the repo/demo/journal (e.g. "the demo needs a
-- restart after 30s", "hardware is at my school, video's in the journal").
-- Optional, cleared to '' on every ship so it never carries over stale
-- context from a prior submission.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ship_note text NOT NULL DEFAULT '';
