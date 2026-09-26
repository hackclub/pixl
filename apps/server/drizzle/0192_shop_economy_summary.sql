-- Aggregate totals for the fulfillment page's "how much we won overall"
-- summary: total pixels players have redeemed in the shop (excluding
-- cancelled/refunded orders) against the real dollars actually spent
-- fulfilling them (apps/dashboard/app/fulfillment/page.tsx). Done as a
-- Postgres function rather than pulling every shop_orders row over the
-- wire and summing client-side, since the table only grows over the
-- program's lifetime.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

CREATE OR REPLACE FUNCTION shop_economy_summary()
RETURNS TABLE (total_px bigint, total_actual_cost_usd numeric, orders_with_cost bigint) AS $$
  SELECT
    COALESCE(SUM(price), 0) AS total_px,
    COALESCE(SUM(actual_cost_usd) FILTER (WHERE actual_cost_usd IS NOT NULL), 0) AS total_actual_cost_usd,
    COUNT(*) FILTER (WHERE actual_cost_usd IS NOT NULL) AS orders_with_cost
  FROM shop_orders
  WHERE status <> 'cancelled';
$$ LANGUAGE sql STABLE;
