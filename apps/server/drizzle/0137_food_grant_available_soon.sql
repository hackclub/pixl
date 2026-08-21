-- Softens the "LOCKED:" wording set by 0135 to "Available soon" - and, in the
-- shop UI (apps/game/web/shop/{index,item}.html) plus the /api/shop payload
-- (apps/server/src/routes/shop.ts, new `unlockPending` field), drops the
-- lock emoji/CTA for items gated behind a Trial that isn't active yet (the
-- Pixl Cafe placeholder), showing a plain "coming soon" instead. Same idea as
-- the existing "NOT AVAILABLE / Coming soon to this region" state for
-- pending-priced items, just for Trial-gated ones.
--
-- NOT idempotent - run once.
-- Target: the orchard/CNPG database. Run in psql.

UPDATE shop_items
SET description = 'A stackable $10 grant for food and snacks while you build. Available soon: unlocks once the Pixl Cafe region launches.'
WHERE name = 'Food Grant';
