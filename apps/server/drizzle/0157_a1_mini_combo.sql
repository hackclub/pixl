-- Add a "Version" configurator to "Bambu Lab A1 Mini", same pattern as
-- 0131_merge_bambu_a1_combo.sql did for the full A1: base Mini (no AMS), or
-- Combo (+ AMS Lite) at a per-region price delta.
--
-- Bambu Lab's own US store (verified live): A1 mini $299 standalone, A1 mini
-- Combo (+AMS Lite) $449 -> a $150 delta. There's no single official Bambu
-- store covering every region here (AFRICA/SOUTH_AMERICA/ASIA/INDIA pricing
-- online is scattered reseller listings that disagree by 2x or more, not
-- trustworthy enough to hardcode). Rather than guess those directly, this
-- scales the verified $150 US delta by each region's EXISTING A1 Mini base
-- price ratio to US - the same regional cost-of-goods adjustment already
-- baked into those base prices - then converts at pixelValueUsd and rounds
-- up to the nearest 5 (this shop's price-rounding convention).
--
-- Per-region base + delta (px):
--   AFRICA 4475 +3000 | ASIA 3340 +2240 | EUROPE 3155 +2115 | INDIA 3200 +2145
--   NORTH_AMERICA 3200 +2145 | SOUTH_AMERICA 5750 +3855 | US 3200 +2145
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

BEGIN;

UPDATE shop_items SET description =
  'An ultra-compact, beginner-friendly 3D printer for small props and parts. Pick the standard Mini, or upgrade to the Combo (adds the AMS Lite for multi-color printing).'
WHERE name = 'Bambu Lab A1 Mini';

-- Both choices reuse the item's existing photo (image_url) - there's no
-- separate Mini-Combo product shot uploaded yet, unlike the full A1 which
-- already had one from its old standalone "Bambu Lab A1 Combo" listing.
UPDATE shop_items SET config_options =
  ('{"base_price":' || price || ',"groups":[{"name":"Version","type":"single","choices":['
   || '{"label":"A1 Mini (single-color)","price":0,"image":"' || image_url || '"},'
   || '{"label":"A1 Mini Combo (+ AMS Lite, multi-color)","price":' || d.delta || ',"image":"' || image_url || '"}'
   || ']}]}')::jsonb
FROM (VALUES
  ('AFRICA', 3000), ('ASIA', 2240), ('EUROPE', 2115), ('INDIA', 2145),
  ('NORTH_AMERICA', 2145), ('SOUTH_AMERICA', 3855), ('US', 2145)
) AS d(region, delta)
WHERE shop_items.name = 'Bambu Lab A1 Mini' AND shop_items.region = d.region;

COMMIT;
