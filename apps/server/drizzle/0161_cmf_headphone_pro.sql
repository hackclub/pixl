-- Replaces "Sony WH-CH720N" with "CMF Headphone Pro" (CMF by Nothing) in the
-- shop, across all 7 regions. The Sony row is deactivated (not deleted) in
-- every region so past orders referencing it stay intact, same as the
-- toggleShopItem hide/show path.
--
-- CMF Headphone Pro pricing (Gabin, 2026-09-05), real local retail -> USD ->
-- pixels at pixelValueUsd=0.07 (packages/config/pixl.json), rounded to the
-- nearest 5:
--   US             $70 (given; matches a real sale price, official MSRP $99) -> 1000px
--   NORTH_AMERICA  CA$139.99 (Nothing CA) ~ $99                              -> 1415px
--   SOUTH_AMERICA  R$702.16 (Magazine Luiza)  ~ $127                        -> 1815px
--   EUROPE         GBP79 (UK launch price)    ~ $106                        -> 1515px
--   ASIA           S$159 (Nothing SG)         ~ $119                        -> 1700px
--   INDIA          Rs7,999 MRP                ~ $96                         -> 1370px
--   AFRICA         no confirmed ZAR retail found; estimated from the
--                  Sony WH-CH720N AFRICA/US price ratio (~1.4x) as the
--                  closest real comparable this shop already prices        -> 1395px
--
-- Colors: real lineup is Dark Grey / Light Grey / Light Green (no true
-- black colorway exists), modeled as a "Color" config_options group with a
-- zero pixel delta per choice - purely cosmetic, no price impact.
-- Image: apps/landing/public/shop/cmf-headphone-pro.png (official product
-- photo, resized from Nothing's CDN). Idempotent (ON CONFLICT on name+region).

UPDATE shop_items
SET active = false
WHERE name = 'Sony WH-CH720N' AND created_by = 'landing-sync';

INSERT INTO shop_items (name, description, price, image_url, options, config_options, active, position, created_by, unlock_xp, category, region)
SELECT
  'CMF Headphone Pro',
  'CMF by Nothing over-ear ANC headphones - Hi-Res LDAC audio, up to 100 hours playback, 40dB active noise cancelling. Pick your color below.',
  v.price,
  'https://pixl.hackclub.com/shop/cmf-headphone-pro.png',
  '[]'::jsonb,
  jsonb_build_object(
    'base_price', v.price,
    'groups', jsonb_build_array(
      jsonb_build_object(
        'name', 'Color',
        'type', 'single',
        'choices', jsonb_build_array(
          jsonb_build_object('label', 'Dark Grey', 'price', 0),
          jsonb_build_object('label', 'Light Grey', 'price', 0),
          jsonb_build_object('label', 'Light Green', 'price', 0)
        )
      )
    )
  ),
  true, 26, 'landing-sync', 0, 'tech', v.region
FROM (VALUES
  ('US', 1000),
  ('NORTH_AMERICA', 1415),
  ('SOUTH_AMERICA', 1815),
  ('EUROPE', 1515),
  ('ASIA', 1700),
  ('INDIA', 1370),
  ('AFRICA', 1395)
) AS v(region, price)
ON CONFLICT (name, region) DO UPDATE SET
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  config_options = EXCLUDED.config_options,
  active = true;
