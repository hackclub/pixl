-- Add BANGLADESH as an 8th shop region, stocked from the Bangladesh Region
-- prices sheet (BDT retailers, USD-equivalent), and route BD players there
-- automatically (previously bucketed into ASIA, see apps/server/src/routes/shop.ts).
--
-- Pricing pipeline: same as every other region (0097/0104/0114) -
-- hours = round(usd / 3.5, nearest 0.5h) -> px = hours * 50 -> +10% rounded
-- to nearest 25px. This is unrelated to the current $4/h -> ~57px earn rate
-- in packages/config/pixl.json (that governs player payouts, not shop
-- pricing) - the shop's per-pixel value has stayed a flat $0.07 since 0097.
--
-- Items with a real BD price get that. Items whose sheet cell was
-- "Unavailable" / "Out of stock" / "NO RELIABLE SOURCES" get price=0
-- (renders as "NOT AVAILABLE - Coming soon to this region", same as any
-- other 0-priced item). Items marked "-" (no research done) or missing from
-- the sheet entirely are cloned at the exact US price/active state. Framework
-- 13/16 DIY are "Doesnt ship to bd" on the sheet, so - same as their
-- exclusion from ASIA/SOUTH_AMERICA/AFRICA in 0097/0115 - they get no row at
-- all rather than a price=0 one (their config_options reference a US-only
-- spec sheet). Food Grant stays at its US price of 0 (that's a feature gate
-- on the Pixl Cafe region launching, not a real regional price - the sheet's
-- $5 doesn't override it). Nintendo Switch 2 is currently inactive in US
-- (out of stock there) but the sheet gives it a real BD price, so it's
-- active here despite that.
--
-- Judgment call: the sheet's "Hollow Knight,-" row doesn't match any real
-- catalog item (Hollow Knight is one of the 27 choices inside "Indie Game of
-- Your Choice") - treated as referring to that item, cloned at the US price.
--
-- Idempotent. Run against the orchard/CNPG database.

BEGIN;

ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_region_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_region_check
  CHECK (region IN ('US', 'ASIA', 'NORTH_AMERICA', 'SOUTH_AMERICA', 'EUROPE', 'INDIA', 'AFRICA', 'BANGLADESH'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_region_check;
ALTER TABLE users ADD CONSTRAINT users_region_check
  CHECK (region IN ('US', 'ASIA', 'NORTH_AMERICA', 'SOUTH_AMERICA', 'EUROPE', 'INDIA', 'AFRICA', 'BANGLADESH'));

-- ── 1. Items with a real, researched BD price (converted via the standard
--    pipeline above) or an explicit unavailable/out-of-stock/no-source mark
--    (price 0). ──
INSERT INTO shop_items (name, description, price, image_url, options, active, position, created_by, unlock_xp, config_options, category, region)
SELECT s.name, s.description, v.price, s.image_url, s.options, v.active, s.position, s.created_by, s.unlock_xp, s.config_options, s.category, 'BANGLADESH'
FROM (VALUES
  ('Huawei MatePad 11.5', 6400, true),
  ('Soldering Iron', 375, true),
  ('ESP32 Starter Kit', 375, true),
  ('Electric Screwdriver Set', 600, true),
  ('8bitDo 2C Ultimate controller', 450, true),
  ('Wacom Intuos (Small)', 1350, true),
  ('Apple Pencil USB-C', 1275, true),
  ('Logitech MX Master 3S', 1550, true),
  ('CMF Headphone Pro', 1175, true),
  ('Apple Pencil Pro', 1850, true),
  ('Raspberry Pi 5', 4375, true),
  ('Creality Ender 3 V3 SE', 4675, true),
  ('Bambu Lab A1 Mini', 4200, true),
  ('Samsung Odyssey G5', 6025, true),
  ('AirPods Pro 3', 3325, true),
  ('Creality Sparkx i7', 14825, true),
  ('Bambu Lab A1', 7300, true),
  ('Sony WH-1000XM5', 3900, true),
  ('Centauri Carbon', 10800, true),
  ('iPad (11th gen)', 7050, true),
  ('Nintendo Switch 2', 8300, true),
  ('Nothing Phone (4a) Pro', 7525, true),
  ('AirPods Max 2', 9575, true),
  ('MacBook Neo', 11250, true),
  ('Samsung Galaxy S24', 7675, true),
  ('iPad Air (M4, 128GB)', 12025, true),
  ('Mac Mini (24GB/512GB)', 12275, true),
  ('MacBook Air M5', 22500, true),
  -- Unavailable / out of stock / no reliable source in BD
  ('FURYCUBE 68%', 0, true),
  ('Godot Plush (Limited Edition)', 0, true),
  ('Epomaker x Aula S75 Pro', 0, true),
  ('Retro Handheld (Miyoo Mini+ / RG35XX)', 0, true),
  ('Samsung T7 External SSD (1TB)', 0, true),
  ('PS5 digital/disc 1tb', 0, true),
  -- Feature-gated the same way in every region, not a real regional price
  ('Food Grant', 0, true)
) AS v(name, price, active)
JOIN shop_items s ON s.name = v.name AND s.region = 'US'
WHERE NOT EXISTS (SELECT 1 FROM shop_items e WHERE e.name = v.name AND e.region = 'BANGLADESH');

-- ── 2. Everything else: no research on the sheet ("-") or missing from it
--    entirely -> cloned at the exact US price and active state. Framework
--    13/16 DIY are deliberately excluded (see header note). ──
INSERT INTO shop_items (name, description, price, image_url, options, active, position, created_by, unlock_xp, config_options, category, region)
SELECT name, description, price, image_url, options, active, position, created_by, unlock_xp, config_options, category, 'BANGLADESH'
FROM shop_items s
WHERE s.region = 'US'
  AND coalesce(s.unlock_xp, 0) = 0
  AND s.name IN (
    'Signed Org Photo', 'Community Meme Pack (5-Pack)', '10$ printing grant', 'Game Assets Grant',
    'Music Grant', 'Art Supply Grant', 'Hardware Grant', 'Hosting Grant', 'AI subscription/credits',
    'Domain Grant', '15$ HQ shipping grant', 'Pixl Sticker Pack', 'PIXL Cookie Cutter',
    'Pixel Composer License', 'PICO-8 License', 'PIXL Poster', 'Aseprite License', 'PIXL Hoodie',
    'CPU/GPU Grant', 'RAM Grant', 'GTA VI (Standard Edition)', '100$ laptop grant', 'GameMaker Pro',
    'Steam License', 'Apple Developer License', 'Google Play Developer License',
    'Indie Game of Your Choice', 'Random Desk Object'
  )
  AND NOT EXISTS (SELECT 1 FROM shop_items e WHERE e.name = s.name AND e.region = 'BANGLADESH');

COMMIT;
