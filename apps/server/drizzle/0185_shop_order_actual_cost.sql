-- The real dollar amount an order actually cost to fulfill, alongside its HCB
-- link (see 0184_shop_order_hcb_link.sql) - distinct from `price` (the
-- player's pixel cost) and the derived "budget" shown in the dashboard
-- (price * pixelValueUsd, a ceiling, not what was actually spent). Same
-- numeric(10,2) shape as projects.funding_usd. Null until a fulfiller records
-- it; not required historically, only going forward (see claimOrder in
-- apps/dashboard/app/actions.ts).
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS actual_cost_usd numeric(10,2);
