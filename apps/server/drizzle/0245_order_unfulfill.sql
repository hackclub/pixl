-- Unfulfilling an order reopens a completed order without undoing any of the
-- work or money that already went into it. The previous fulfillment (who, when,
-- HCB link, cost, tracking, payout) is copied into shop_order_unfulfillments
-- with the reason it was reopened, then the order goes back to its claimer's
-- queue and the normal fulfill/grant action can run again.
--
-- The payout is deliberately NOT clawed back: fulfillment_pixels_paid stays on
-- shop_orders and settlement adds to it on a later attempt, so the leaderboard
-- keeps counting every paid fulfillment.
--
-- item_flow forces an order onto the normal item-purchase flow even when its
-- shop item is in the "grants" category. A cancelled/refunded grant that gets
-- bought directly instead uses this; is_grant still wins if both are set, so
-- "Convert to grant" keeps working.
--
-- Run against the orchard/CNPG database. Safe to re-run.

ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS item_flow boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shop_order_unfulfillments (
  id bigint generated always as identity primary key,
  order_id bigint NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  -- How this particular fulfillment was completed: 'grant' or 'item'.
  fulfillment_kind text NOT NULL DEFAULT 'item',
  fulfilled_at timestamptz,
  fulfilled_by text NOT NULL DEFAULT '',
  fulfilled_by_slack text NOT NULL DEFAULT '',
  hcb_link text NOT NULL DEFAULT '',
  tracking text NOT NULL DEFAULT '',
  actual_cost_usd numeric(10,2),
  -- Pixels paid for this attempt only. The order keeps the running total in
  -- shop_orders.fulfillment_pixels_paid.
  pixels_paid integer NOT NULL DEFAULT 0,
  unfulfilled_at timestamptz NOT NULL DEFAULT now(),
  unfulfilled_by text NOT NULL DEFAULT '',
  unfulfilled_by_slack text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_shop_order_unfulfillments_order
  ON shop_order_unfulfillments(order_id, unfulfilled_at);
