-- Adds an "Edition" modifier to GTA VI so players can buy the Ultimate
-- Edition instead of Standard, using the same config_options mechanism as
-- the Framework 16 DIY configurator (see 0058_shop_item_configurator.sql for
-- the full shape/semantics: base_price + a "single"-type group means the
-- buyer picks exactly one choice, its "price" is a PIXEL delta added on top
-- of base_price).
--
-- Ultimate Edition retail prices (Gabin, 2026-08-21), converted to USD,
-- averaged per region where more than one country applies, then to a pixel
-- DELTA on top of that region's existing Standard price using the same
-- formula as 0102 (hours = usd / 3.5, rounded to the nearest half hour,
-- px = hours * 50):
--
--   Region          source price(s)                 USD (avg)  Ultimate px  Standard px  delta
--   US              $99.99                             99.99      1425         1150       +275
--   NORTH_AMERICA   CAD 139.99 (Canada)                 98.00      1400         1200       +200
--   SOUTH_AMERICA   R$549.90 (Brazil)                  106.00      1525         1275       +250
--   EUROPE          EUR99.99 / GBP89.99 / CHF99.90     118.00      1675         1325       +350
--   ASIA            JPY12280/KRW112800/HKD708/SGD136/THB3390  89.00  1275       950        +325
--   INDIA           INR7499                             79.00      1125          900       +225
--   AFRICA          ZAR1899                            114.00      1625         1325       +300
--
-- base_price stays each region's EXISTING shop_items.price (today's Standard
-- price), so buying without touching the Edition picker still charges
-- exactly what it does today.
--
-- Safe to run more than once (idempotent UPDATE keyed on name + created_by +
-- region). Run this in the Supabase SQL editor.

UPDATE shop_items s
SET config_options = jsonb_build_object(
  'base_price', s.price,
  'groups', jsonb_build_array(
    jsonb_build_object(
      'name', 'Edition',
      'type', 'single',
      'choices', jsonb_build_array(
        jsonb_build_object('label', 'Standard Edition', 'price', 0),
        jsonb_build_object('label', 'Ultimate Edition', 'price', v.delta)
      )
    )
  )
)
FROM (VALUES
  ('US', 275),
  ('NORTH_AMERICA', 200),
  ('SOUTH_AMERICA', 250),
  ('EUROPE', 350),
  ('ASIA', 325),
  ('INDIA', 225),
  ('AFRICA', 300)
) AS v(region, delta)
WHERE s.name = 'GTA VI (Standard Edition)'
  AND s.created_by = 'landing-sync'
  AND s.region = v.region;
