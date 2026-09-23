-- Fulfillers now earn a flat 3px for every order they actually ship (see
-- shipOrder in apps/dashboard/app/actions.ts) - the amount actually paid is
-- stored per order rather than just a boolean, so a future rate change never
-- becomes ambiguous about what an already-paid order was worth, and the
-- fulfillment leaderboard can just SUM() this column. 0 = not yet paid.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfillment_pixels_paid integer NOT NULL DEFAULT 0;
