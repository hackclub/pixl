-- Grant orders get their own short fulfilment flow (claim -> send grant -> done)
-- in the internal dashboard. An order is a grant when its shop item is in the
-- "grants" category OR a fulfiller converted it with "Convert to grant" (for
-- grant-shaped orders on items that aren't tagged as grants). This flag is the
-- per-order half of that rule; the category half lives on shop_items.
ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS is_grant boolean NOT NULL DEFAULT false;
