-- Update EUROPE region shop prices to verified market-average values.
-- Source: user-provided hardware price comparison report (2026-09).
-- Excluded on purpose: PS5 (both listings), Random Desk Object, Signed Org
-- Photo, Community Meme Pack, all grants, and Samsung Galaxy S24 (currently
-- price 0 / unavailable - changing its price would make it purchasable,
-- which is an availability change, not a price update).

UPDATE shop_items SET price = 3125 WHERE region = 'EUROPE' AND name = 'Bambu Lab A1 Mini';
UPDATE shop_items SET price = 3275 WHERE region = 'EUROPE' AND name = 'Creality Sparkx i7';
UPDATE shop_items SET price = 4275 WHERE region = 'EUROPE' AND name = 'Bambu Lab A1';
UPDATE shop_items SET price = 5100 WHERE region = 'EUROPE' AND name = 'Centauri Carbon';
UPDATE shop_items SET price = 1325 WHERE region = 'EUROPE' AND name = 'GTA VI (Standard Edition)';
UPDATE shop_items SET price = 525  WHERE region = 'EUROPE' AND name = '8bitDo 2C Ultimate controller';
UPDATE shop_items SET price = 1425 WHERE region = 'EUROPE' AND name = 'Logitech MX Master 3S';
UPDATE shop_items SET price = 1475 WHERE region = 'EUROPE' AND name = 'Apple Pencil USB-C';
-- ESP32 Starter Kit intentionally excluded per user request (undo/skip).
UPDATE shop_items SET price = 800  WHERE region = 'EUROPE' AND name = 'Wacom Intuos (Small)';
UPDATE shop_items SET price = 1650 WHERE region = 'EUROPE' AND name = 'Retro Handheld (Miyoo Mini+ / RG35XX)';
UPDATE shop_items SET price = 1400 WHERE region = 'EUROPE' AND name = 'Epomaker x Aula S75 Pro';
UPDATE shop_items SET price = 3050 WHERE region = 'EUROPE' AND name = 'Raspberry Pi 5';
UPDATE shop_items SET price = 1475 WHERE region = 'EUROPE' AND name = 'CMF Headphone Pro';
UPDATE shop_items SET price = 2775 WHERE region = 'EUROPE' AND name = 'Creality Ender 3 V3 SE';
UPDATE shop_items SET price = 4100 WHERE region = 'EUROPE' AND name = 'AirPods Pro 3';
UPDATE shop_items SET price = 2625 WHERE region = 'EUROPE' AND name = 'Samsung T7 External SSD (1TB)';
UPDATE shop_items SET price = 3225 WHERE region = 'EUROPE' AND name = 'Sony WH-1000XM5';
UPDATE shop_items SET price = 8225 WHERE region = 'EUROPE' AND name = 'iPad (11th gen)';
UPDATE shop_items SET price = 7875 WHERE region = 'EUROPE' AND name = 'AirPods Max 2';
UPDATE shop_items SET price = 8300 WHERE region = 'EUROPE' AND name = 'Nothing Phone (4a) Pro';
UPDATE shop_items SET price = 14000 WHERE region = 'EUROPE' AND name = 'MacBook Neo';
UPDATE shop_items SET price = 20175 WHERE region = 'EUROPE' AND name = 'MacBook Air M5';
UPDATE shop_items SET price = 24375 WHERE region = 'EUROPE' AND name = 'Mac Mini (24GB/512GB)';
UPDATE shop_items SET price = 2450 WHERE region = 'EUROPE' AND name = 'Apple Pencil Pro';
UPDATE shop_items SET price = 13675 WHERE region = 'EUROPE' AND name = 'iPad Air (M4, 128GB)';
UPDATE shop_items SET price = 625  WHERE region = 'EUROPE' AND name = 'Soldering Iron';
UPDATE shop_items SET price = 8250 WHERE region = 'EUROPE' AND name = 'Nintendo Switch 2';
UPDATE shop_items SET price = 7400 WHERE region = 'EUROPE' AND name = 'Huawei MatePad 11.5';
UPDATE shop_items SET price = 2475 WHERE region = 'EUROPE' AND name = 'Samsung Odyssey G5';
