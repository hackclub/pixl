-- Locks Food Grant behind shipping a Trial in the Pixl Cafe region (a new
-- region, launching soon — not live yet), using the unlock_trial_ids
-- mechanism from 0129 (same pattern as Music Grant).
--
-- A real "Pixl Cafe" region/Trial didn't exist yet, so this seeds one
-- placeholder Trial (inactive, so nobody can select or ship it while the
-- region isn't live) and gates Food Grant on it. Once Pixl Cafe actually
-- ships, either flesh this Trial out (name/npc/description/reward/brief)
-- and flip it active, or add more real Trials for the region and extend
-- Food Grant's unlock_trial_ids to include them ("ship ANY of these"
-- semantics, per 0129).
--
-- NOTE: this file documents what was already run directly against the
-- Orchard/CNPG database (psql, not Supabase) on 2026-08-21. It's still
-- idempotent / safe to run again — INSERT is guarded by NOT EXISTS.
--
-- Target: the orchard/CNPG database. Run in psql.

INSERT INTO sidequests (name, region, npc, description, reward, active, position, created_by, difficulty, brief)
SELECT
  'Cook something up for the Pixl Cafe',
  'Pixl Cafe',
  '',
  'PLACEHOLDER — Pixl Cafe region is launching soon. Fill in the real NPC, description, reward and brief before the region goes live.',
  'TBD',
  false,
  0,
  'gabin-cli',
  2,
  'TBD — flesh out once the Pixl Cafe region ships.'
WHERE NOT EXISTS (SELECT 1 FROM sidequests WHERE name = 'Cook something up for the Pixl Cafe' AND region = 'Pixl Cafe');

UPDATE shop_items
SET unlock_trial_ids = (
  SELECT array_agg(id) FROM sidequests
  WHERE name = 'Cook something up for the Pixl Cafe' AND region = 'Pixl Cafe'
),
description = 'A stackable $10 grant for food and snacks while you build. LOCKED: unlock it by shipping a Trial in the Pixl Cafe region (launching soon).'
WHERE name = 'Food Grant';
