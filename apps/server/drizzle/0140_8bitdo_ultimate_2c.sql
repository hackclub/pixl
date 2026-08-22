-- Adds "8BitDo Ultimate 2C Wireless Controller (PC)" to the shop.
--
-- Gabin gave 5 of the 7 regions' USD prices; NORTH_AMERICA and SOUTH_AMERICA
-- were not given, so those two rows are inserted at price 0 ("not sold in
-- this region", same convention as every other multi-region hardware item —
-- see e.g. 0128_huawei_matepad.sql) until a real price is supplied.
--
-- USD -> px using the standard formula (hours = usd / 3.5, rounded to the
-- nearest half hour, px = hours * 50 — see 0102_add_gta6_standard.sql):
--
--   Region          USD    hours   px
--   US              $30     8.5   425
--   EUROPE          $35    10.0   500
--   ASIA            $35    10.0   500
--   INDIA           $45    13.0   650
--   AFRICA          $45    13.0   650
--   NORTH_AMERICA   -       -       0   (not given, not sold yet)
--   SOUTH_AMERICA   -       -       0   (not given, not sold yet)
--
-- image_url is left blank ('' — the column default) since no hosted product
-- photo was supplied; set it via the dashboard shop admin before going live.
--
-- Idempotent (WHERE NOT EXISTS keyed on name + region, same pattern as
-- 0102_add_gta6_standard.sql). Run this in the Supabase SQL editor / against
-- the orchard Postgres DB.

INSERT INTO shop_items
  (name, description, price, image_url, options, active, position, created_by, unlock_xp, category, region)
SELECT
  '8BitDo Ultimate 2C Wireless Controller (PC)',
  '8BitDo Ultimate 2C wireless controller for PC. Pick your color below.',
  v.price,
  '',
  '["Color: Transparent Black, Mint, Peach, Green, Purple, Blueberry, Brownie"]'::jsonb,
  true,
  (SELECT coalesce(max(position), 0) + 1 FROM shop_items x WHERE x.region = v.region),
  'landing-sync',
  0,
  'tech',
  v.region
FROM (VALUES
  ('US', 425),
  ('NORTH_AMERICA', 0),
  ('SOUTH_AMERICA', 0),
  ('EUROPE', 500),
  ('ASIA', 500),
  ('INDIA', 650),
  ('AFRICA', 650)
) AS v(region, price)
WHERE NOT EXISTS (
  SELECT 1 FROM shop_items e
  WHERE e.name = '8BitDo Ultimate 2C Wireless Controller (PC)' AND e.region = v.region
);
