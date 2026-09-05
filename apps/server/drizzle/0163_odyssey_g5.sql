-- New shop item: Samsung Odyssey G5 (G51F), 27" flat QHD (2560x1440) 180Hz
-- gaming monitor - the exact product from the Amazon link the user pointed to
-- (ASIN B0GLV9PML4, model LS27FG512ENXZA), NOT the G7 despite the original
-- request wording ("odyssey g7") and NOT the "Odyssey OLED G7" a
-- misbehaving research fork mistakenly added earlier (deactivated) or the
-- classic curved 240Hz "Odyssey G7" added right after that (also
-- deactivated, ids 549-555) - both superseded once the user linked the
-- actual product they meant. Added across all 7 regions, position 63.
--
-- Pricing (Gabin, 2026-09-05), local retail -> USD -> pixels at
-- pixelValueUsd=0.07 (packages/config/pixl.json), rounded to nearest 5.
--   US       $187 (the exact price on the user's linked Amazon listing;      -> 2670px [real, current]
--            official MSRP is ~$249, frequently on sale $149-187)
--   INDIA    Rs23,999 official (samsung.com/in, LS27FG510EWXXL - India's     -> 4105px [real, official]
--            regional SKU number differs but is the same G51F spec) ~ $287
--   NORTH_AMERICA  no clean current CAD price surfaced for this exact SKU;   -> 2670px [ESTIMATE]
--                  estimated at USD parity (Canada list prices for this
--                  tier of monitor tend to land close to the US price
--                  once FX is netted out)
--   EUROPE   no clean current GBP price surfaced for this exact SKU;         -> 3395px [ESTIMATE]
--            estimated via common USD/GBP numeric-parity pattern for
--            electronics (~£187), converted back through GBP/USD FX
--   SOUTH_AMERICA  no live Brazil price for this SKU (search only surfaced   -> 4540px [ESTIMATE]
--                  the pricier OLED G5 variant); estimated via the ~1.7x
--                  Brazil import/tax multiplier used elsewhere in this
--                  catalog for Brazil-vs-US gaps
--   ASIA     no Singapore price surfaced for this SKU; estimated via a       -> 3605px [ESTIMATE]
--            ~1.35x Singapore-vs-US markup (matches the ratio found for
--            other electronics in this catalog)
--   AFRICA   no live South Africa price for this exact SKU (Amazon.co.za    -> 3740px [ESTIMATE]
--            lists it, page didn't load a price); estimated via the same
--            ~1.4x AFRICA/US ratio used for Sony WH-CH720N in this catalog
--
-- Real prices for US/India; the other five are estimates - flagged for a
-- manual spot-check once official regional listings surface a live price.
--
-- Image: apps/landing/public/shop/odyssey-g5.jpg (Amazon product photo,
-- resized). Idempotent (ON CONFLICT on name+region).

INSERT INTO shop_items (name, description, price, image_url, options, config_options, active, position, created_by, unlock_xp, category, region)
SELECT
  'Samsung Odyssey G5',
  '27" flat QHD (2560x1440) gaming monitor, 180Hz refresh rate, 1ms response time, AMD FreeSync, HDR10, height-adjustable stand.',
  v.price,
  'https://pixl.hackclub.com/shop/odyssey-g5.jpg',
  '[]'::jsonb,
  NULL,
  true, 63, 'landing-sync', 0, 'tech', v.region
FROM (VALUES
  ('US', 2670),
  ('NORTH_AMERICA', 2670),
  ('SOUTH_AMERICA', 4540),
  ('EUROPE', 3395),
  ('ASIA', 3605),
  ('INDIA', 4105),
  ('AFRICA', 3740)
) AS v(region, price)
ON CONFLICT (name, region) DO UPDATE SET
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  active = true;
