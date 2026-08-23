-- The three placeholder collectibles from 0060_project_upvotes.sql shipped with
-- empty image_url. Points them at the real badge art now hosted on landing.
--
-- Run in the Supabase SQL editor. Safe to re-run.

UPDATE collectibles
SET image_url = 'https://pixl.rsvp/collectibles/bronze-builder-badge.png'
WHERE name = 'Bronze Builder Badge';

UPDATE collectibles
SET image_url = 'https://pixl.rsvp/collectibles/silver-builder-badge.png'
WHERE name = 'Silver Builder Badge';

UPDATE collectibles
SET image_url = 'https://pixl.rsvp/collectibles/golden-builder-badge.png'
WHERE name = 'Golden Builder Badge';
