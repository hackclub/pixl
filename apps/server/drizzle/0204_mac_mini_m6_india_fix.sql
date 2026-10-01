-- Correction to the Mac Mini M6 INDIA row added in 0203: the real Apple
-- India price for the 24GB RAM / 512GB storage build is $1479 (confirmed by
-- Gabin, apple.com/in), not the $24,500px total the old independently
-- estimated RAM/Storage deltas implied (base 16550 + RAM delta 3975 +
-- storage delta 3975 = 24500).
--
-- Pricing (Claude, 2026-10-01): hours = round(1479 / 3.5, nearest 0.5h) =
-- 422.5h, px = 422.5 * 50 = 21125, +2% (same M6-specific convention as 0203,
-- not the catalog's usual +10%) = 21547.5, rounded to the nearest 25px =
-- 21550.
--
-- Base price (16GB/256GB, Rs99,900) is untouched - only the 24GB RAM and
-- 512GB storage deltas are refit so base + both deltas = 21550, split evenly
-- (21550 - 16550 = 5000, so 2500 each), matching the US item's own pattern
-- of equal RAM/storage step pricing. 32GB RAM and the 1TB/2TB storage tiers
-- are rescaled off the same new per-step delta, keeping the same multipliers
-- 0203 used (32GB = 2x the 24GB step, 1TB = 3x, 2TB = 5x the storage step).
--
-- Idempotent. Run against the orchard/CNPG database.

UPDATE shop_items
SET config_options = jsonb_set(
  jsonb_set(
    config_options,
    '{groups,0,choices}',
    '[{"label": "16GB", "price": 0}, {"label": "24GB", "price": 2500}, {"label": "32GB", "price": 5000}]'::jsonb
  ),
  '{groups,1,choices}',
  '[{"label": "256GB", "price": 0}, {"label": "512GB", "price": 2500}, {"label": "1TB", "price": 7500}, {"label": "2TB", "price": 12500}]'::jsonb
)
WHERE name = 'Mac Mini M6' AND region = 'INDIA';
