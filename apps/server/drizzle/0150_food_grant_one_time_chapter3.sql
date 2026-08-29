-- Tells players up front that Food Grant is a one-time reward for the Pixl
-- Cafe region's Trial (region launches in Chapter 3, per 0135/0137), not a
-- grant they can keep re-earning that amount of once the region ships.
--
-- Kept short on purpose: the catalog card clamps .item-desc to 2 lines
-- (apps/game/web/shop/index.html), so this has to be visible WITHOUT opening
-- the item, not buried after the part that gets clipped.
--
-- Idempotent - safe to run again, plain UPDATE.
-- Target: the orchard/CNPG database. Run in psql.

UPDATE shop_items
SET description = 'One-time 20$ grant, get it with a chapter 3 Pixl Cafe trial'
WHERE name = 'Food Grant';
