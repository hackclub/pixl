-- 0204_mac_mini_m6_india_fix.sql applied a now-stale correction (RAM/storage
-- deltas 2500/2500, computed before the broader pixelValueUsd rate bug in
-- 0203 was found and fixed directly in that file). 0203 was then rewritten
-- in place with the real final numbers (base 12175, deltas 1450/1450) - but
-- since both are already committed and pushed, replaying migrations in
-- order on a fresh database runs 0203 (correct) then 0204 (stale), which
-- would silently regress India back to the wrong deltas. This re-applies
-- the correct ones so migration replay order can't matter.
--
-- Idempotent. Run against the orchard/CNPG database (already applied live
-- there directly - this is purely to keep migration replay consistent).

UPDATE shop_items
SET config_options = jsonb_set(
  jsonb_set(
    config_options,
    '{groups,0,choices}',
    '[{"label": "16GB", "price": 0}, {"label": "24GB", "price": 1450}, {"label": "32GB", "price": 2925}]'::jsonb
  ),
  '{groups,1,choices}',
  '[{"label": "256GB", "price": 0}, {"label": "512GB", "price": 1450}, {"label": "1TB", "price": 4375}, {"label": "2TB", "price": 7300}]'::jsonb
)
WHERE name = 'Mac Mini M6' AND region = 'INDIA';
