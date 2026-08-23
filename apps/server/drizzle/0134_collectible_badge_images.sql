-- The three placeholder collectibles from 0060_project_upvotes.sql shipped with
-- empty image_url. Points them at the real badge art, hosted alongside the
-- other web-shell stickers (apps/game/web/img/) rather than on landing:
-- pixl.rsvp currently has no live deployment, and the game shell is what
-- actually serves /collectibles/ anyway.
--
-- Run in the Supabase SQL editor. Safe to re-run.

UPDATE collectibles
SET image_url = 'https://pixl.hackclub.com/img/bronze-builder-badge.png'
WHERE name = 'Bronze Builder Badge';

UPDATE collectibles
SET image_url = 'https://pixl.hackclub.com/img/silver-builder-badge.png'
WHERE name = 'Silver Builder Badge';

UPDATE collectibles
SET image_url = 'https://pixl.hackclub.com/img/golden-builder-badge.png'
WHERE name = 'Golden Builder Badge';
