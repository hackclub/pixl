-- +10% on GTA VI's Ultimate Edition delta only, matching 0104's shop-wide
-- +10% pass (same rounding: nearest 25px). 0104 already covered the flat
-- `price` column (Standard Edition / base_price) before this Ultimate
-- Edition option existed (0134), so this catches up just the new
-- config_options delta rather than re-bumping base_price.
--
-- delta before -> after: US 275->300, NORTH_AMERICA 200->225,
-- SOUTH_AMERICA 250->275, EUROPE 350->375, ASIA 325->350, INDIA 225->250,
-- AFRICA 300->325.
--
-- NOT idempotent - run once. Does not go through the app, so pixorpheus'
-- shop-webhook never fires for this (intentional, per the request).
--
-- Target: the orchard/CNPG database. Run in psql.

UPDATE shop_items
SET config_options = jsonb_set(
  config_options,
  '{groups,0,choices,1,price}',
  to_jsonb((round(((config_options->'groups'->0->'choices'->1->>'price')::numeric * 1.1) / 25.0) * 25)::int)
)
WHERE name = 'GTA VI (Standard Edition)' AND created_by = 'landing-sync';
