-- New shop item: "Mac Mini M6" - Apple's current Mac mini (M6 chip,
-- announced 2026-08-25, shipping since 2026-09-22), added as its OWN item
-- alongside the existing "Mac Mini (24GB/512GB)" (M4) - that one is left
-- completely untouched, this is a new SKU, not a replacement.
--
-- Unlike the old flat-SKU item, this is a real configurator: base is
-- 16GB/256GB, with separate RAM (16/24/32GB) and Storage (256GB/512GB/1TB/
-- 2TB) groups so a player can pick either independently, same config_options
-- shape as Framework 13/16 DIY (0058/0059/0066).
--
-- Pricing (Claude, 2026-10-01): px = round_nearest_25(usd * 10 * 1.02).
-- 10 is the current px-per-dollar rate (1 / pixelValueUsd, see
-- packages/config/pixl.json - $0.10/px since 0190_pixel_value_rescale.sql,
-- 2026-09-26), +2% is explicitly requested for this item (NOT the +10%
-- convention 0097/0174 used for the rest of the catalog). "usd" below means
-- each region's own real/estimated price, not a straight US-to-region
-- conversion.
--   US    real, official Apple US pricing (apple.com, 2026-10-01):
--         base $899, +24GB $200, +32GB $400, +512GB $200, +1TB $600, +2TB $1000
--   INDIA real for base (apple.com/in: Rs99,900 ~ $1193) and for the
--         24GB RAM + 512GB storage combo together ($1479, confirmed by
--         Gabin against apple.com/in, 2026-10-01) - the remaining $286 over
--         base is split evenly across the RAM and storage deltas ($143
--         each), same even-split pattern used for every other region below;
--         32GB/1TB/2TB aren't published yet, estimated via the same
--         multipliers as every other region (32GB = 2x the 24GB step,
--         1TB = 3x, 2TB = 5x the storage step)
--   EUROPE (UK reference) real for base/+512GB storage (apple.com/uk: £899 /
--         £1,199) - base is at US numeric parity but the storage delta isn't
--         (£300, a ~1.9x ratio vs the $200 US delta) - kept faithful to the
--         real number rather than smoothed; RAM deltas and the remaining
--         storage tiers aren't published yet, estimated via each of those
--         two observed ratios respectively
--   NORTH_AMERICA  no CAD price surfaced - estimated at USD parity (same
--         heuristic used for this region elsewhere in the catalog, e.g. 0163)
--   SOUTH_AMERICA  no BRL price surfaced - estimated via the ~1.7x
--         Brazil-vs-US ratio used elsewhere in this catalog (0163)
--   ASIA  no Singapore price surfaced - estimated via the ~1.35x
--         Singapore-vs-US ratio used elsewhere in this catalog (0163)
--   AFRICA  no ZAR price surfaced - estimated via the ~1.4x South
--         Africa-vs-US ratio used elsewhere in this catalog (0163)
--   BANGLADESH  no research done - cloned at the exact US price, same rule
--         0174 uses for any item missing from the BD research sheet
--
-- Flagged for a manual spot-check once official non-US/India/UK listings
-- surface real prices, same as 0163's own stated caveat for its estimates.
--
-- Image is a placeholder (reused from the old Mac Mini item) until a real
-- M6 product photo is supplied - swap shop_items.image_url once available.
--
-- Idempotent (ON CONFLICT on name+region). Run against the orchard/CNPG database.

INSERT INTO shop_items (
  name, description, price, image_url, options, config_options,
  active, position, created_by, unlock_xp, category, region
)
VALUES
('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 9175,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 9175,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2050 },
       { "label": "32GB", "price": 4075 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 2050 },
       { "label": "1TB", "price": 6125 },
       { "label": "2TB", "price": 10200 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'US'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 12175,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 12175,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 1450 },
       { "label": "32GB", "price": 2925 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 1450 },
       { "label": "1TB", "price": 4375 },
       { "label": "2TB", "price": 7300 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'INDIA'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 11650,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 11650,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2600 },
       { "label": "32GB", "price": 5175 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 3875 },
       { "label": "1TB", "price": 11650 },
       { "label": "2TB", "price": 19425 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'EUROPE'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 9175,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 9175,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2050 },
       { "label": "32GB", "price": 4075 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 2050 },
       { "label": "1TB", "price": 6125 },
       { "label": "2TB", "price": 10200 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'NORTH_AMERICA'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 15600,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 15600,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 3475 },
       { "label": "32GB", "price": 6925 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 3475 },
       { "label": "1TB", "price": 10400 },
       { "label": "2TB", "price": 17350 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'SOUTH_AMERICA'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 12375,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 12375,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2750 },
       { "label": "32GB", "price": 5500 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 2750 },
       { "label": "1TB", "price": 8250 },
       { "label": "2TB", "price": 13775 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'ASIA'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 12850,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 12850,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2850 },
       { "label": "32GB", "price": 5700 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 2850 },
       { "label": "1TB", "price": 8575 },
       { "label": "2TB", "price": 14275 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'AFRICA'),

('Mac Mini M6', 'Apple''s current Mac mini, M6 chip. Configure RAM and storage below.', 9175,
 'https://pixl.rsvp/shop/mac-mini-m6-nobg.webp', '[]'::jsonb,
 '{
   "base_price": 9175,
   "reference_url": "https://www.apple.com/shop/buy-mac/mac-mini",
   "groups": [
     { "name": "RAM", "type": "single", "choices": [
       { "label": "16GB", "price": 0 },
       { "label": "24GB", "price": 2050 },
       { "label": "32GB", "price": 4075 }
     ] },
     { "name": "Storage", "type": "single", "choices": [
       { "label": "256GB", "price": 0 },
       { "label": "512GB", "price": 2050 },
       { "label": "1TB", "price": 6125 },
       { "label": "2TB", "price": 10200 }
     ] }
   ]
 }'::jsonb,
 true, 200, 'landing-sync', 0, 'tech', 'BANGLADESH')

ON CONFLICT (name, region) DO UPDATE SET
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  image_url = EXCLUDED.image_url,
  config_options = EXCLUDED.config_options,
  active = true,
  category = EXCLUDED.category;
