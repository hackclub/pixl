-- A shop item can now be locked behind having a Beacon project (see
-- toggleProjectPeak in apps/dashboard/app/actions.ts / projects.is_peak) -
-- distinct from manual_locked/unlock_trial_ids, which are boolean gates.
-- This one is a COUNTING gate: each Beacon-nominated project a player has
-- grants exactly one Beacon-locked item unlock, spendable on any one such
-- item (see the availability check in apps/server/src/routes/shop.ts). No
-- separate ledger table needed - "already spent" is just this player's
-- non-cancelled shop_orders for beacon_locked items, same way every other
-- purchase is already tracked.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS beacon_locked boolean NOT NULL DEFAULT false;
