-- Fulfillment now requires an HCB link (the transaction or grant on
-- hcb.hackclub.com) when an order moves pending -> ordered (see claimOrder in
-- apps/dashboard/app/actions.ts), so every fulfilled order has a paper trail
-- back to the actual HCB spend. Same shape as the existing `tracking` column
-- on this table.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS hcb_link text NOT NULL DEFAULT '';
