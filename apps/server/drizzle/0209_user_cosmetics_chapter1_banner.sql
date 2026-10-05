-- Player cosmetics (titles, banners, ...): one row per thing a player owns.
-- Nothing stored these before; Chapter 1 ("The Core Awakens", vault level 1)
-- lists a "1 banner" reward (and an "Awakened" title) that was only ever
-- label text on vault_levels.rewards.
--
-- kind: 'banner' | 'title' (free text so new kinds need no migration)
-- key:  which one, e.g. 'chapter_1'
-- source: where the grant came from, for audits
--
-- Chapter 1 banner, granted to every player who shipped a project to review
-- before the chapter unlocked (2026-10-05 19:08:14.966+00), whether or not it
-- was ever approved: a ship counts, so "first shipped" (first_shipped_at,
-- falling back to shipped_at) is the test. Projects that were later unshipped
-- back to draft have no shipped_at and can't be counted.
--
-- Idempotent. Run against the orchard/CNPG database.

CREATE TABLE IF NOT EXISTS user_cosmetics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  key text NOT NULL,
  source text NOT NULL DEFAULT '',
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, key)
);

CREATE INDEX IF NOT EXISTS user_cosmetics_user_idx ON user_cosmetics (user_id);

INSERT INTO user_cosmetics (user_id, kind, key, source)
SELECT DISTINCT p.user_id, 'banner', 'chapter_1', 'vault_chapter_1_shipped_before_unlock'
FROM projects p
WHERE COALESCE(p.first_shipped_at, p.shipped_at) < '2026-10-05 19:08:14.966+00'
ON CONFLICT (user_id, kind, key) DO NOTHING;
