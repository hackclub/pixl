-- Adds an "Edition" modifier to GTA VI so players can buy the Ultimate
-- Edition instead of Standard, using the same config_options mechanism as
-- the Framework 16 DIY configurator (see 0058_shop_item_configurator.sql for
-- the full shape/semantics: base_price + a "single"-type group means the
-- buyer picks exactly one choice, its "price" is a PIXEL delta added on top
-- of base_price).
--
-- *** DO NOT RUN YET ***
-- The Ultimate Edition price delta below is a PLACEHOLDER (999999999 px,
-- deliberately absurd so this can't accidentally go live underpriced).
-- Waiting on real per-region Ultimate Edition prices from Gabin before this
-- is safe to run — once given, replace every 999999999 with the real pixel
-- delta (same conversion as 0102: USD delta / 3.5 -> hours, hours * 50 -> px,
-- rounded to the nearest half hour) for that region, then run in the
-- Supabase SQL editor. Safe to run more than once after that (idempotent
-- UPDATE keyed on name + created_by + region).
--
-- base_price is set to each region's EXISTING shop_items.price (the current
-- Standard Edition price), so buying without touching the Edition picker
-- still charges exactly what it does today.

UPDATE shop_items
SET config_options = jsonb_build_object(
  'base_price', price,
  'groups', jsonb_build_array(
    jsonb_build_object(
      'name', 'Edition',
      'type', 'single',
      'choices', jsonb_build_array(
        jsonb_build_object('label', 'Standard Edition', 'price', 0),
        jsonb_build_object('label', 'Ultimate Edition', 'price', 999999999)
      )
    )
  )
)
WHERE name = 'GTA VI (Standard Edition)' AND created_by = 'landing-sync';
