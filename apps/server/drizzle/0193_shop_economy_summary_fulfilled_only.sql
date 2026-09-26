-- Fixes 0192_shop_economy_summary.sql: it summed `price` across every
-- non-cancelled order (pending/ordered included) but only summed
-- actual_cost_usd across the fulfilled subset that has one recorded -
-- comparing all pixels ever redeemed against only some of the real spend,
-- inflating "net" with orders that haven't actually been bought yet.
--
-- Both totals are now scoped to the exact same cohort: orders that have an
-- actual_cost_usd on file, i.e. have actually reached credited-or-later
-- (see markOrderCredited in app/actions.ts, which requires it). That's a
-- true fulfilled-vs-fulfilled comparison.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

CREATE OR REPLACE FUNCTION shop_economy_summary()
RETURNS TABLE (total_px bigint, total_actual_cost_usd numeric, orders_with_cost bigint) AS $$
  SELECT
    COALESCE(SUM(price), 0) AS total_px,
    COALESCE(SUM(actual_cost_usd), 0) AS total_actual_cost_usd,
    COUNT(*) AS orders_with_cost
  FROM shop_orders
  WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL;
$$ LANGUAGE sql STABLE;
