-- Rescales the pixel economy from pixelValueUsd $0.07 -> $0.10 (see
-- packages/config/pixl.json). $0.07 meant $4.00-$6.00/hr (base-cap) converted
-- to 57.14-85.71 px/hr - never a whole number, so every payout's rounding to
-- the nearest whole pixel made the *effective* px-per-dollar rate drift
-- project to project (a 1h project at cap: round(85.71)=86px, 86/$6=14.33
-- px/$; a 2h project: round(171.43)=171px, 171/$12=14.25 px/$ - same rate,
-- different rounding). $0.10 makes 4.00/0.10=40 and 6.00/0.10=60 exactly, so
-- the floor and cap rates - where most players actually sit - convert with
-- zero rounding at all. Mid-ramp RE values still round same as before, just
-- a smaller effect than at the boundaries.
--
-- Every pixel amount already on the books was priced/earned under the old
-- $0.07 rate. Left alone, changing the rate would silently make every
-- existing balance and every catalog price worth ~43% more in real dollars
-- overnight (0.10/0.07), and shop prices wouldn't move to compensate. This
-- migration rescales both sides by the same factor (0.07/0.10 = 0.7) so the
-- real dollar value of anything already earned or priced is unchanged - only
-- the going-forward rate moves. Same approach as
-- 0100_re_economy_rescale.sql's community-RE rescale when that ratio changed.
--
-- Rounds each row independently to the nearest whole pixel (same rounding the
-- normal payout path already does and that docs/150-rewards.md explains) -
-- expect at most a fraction of a pixel of drift between a rescaled ledger row
-- and its paired balance/order row, never more than it already tolerated.
--
-- shop_items.price is plain round(price * 0.7), same as everything else - NOT
-- snapped to the catalog's nearest-25px convention (see
-- 0104_raise_all_prices_10pct.sql). An earlier version of this migration did
-- snap to that grid, which silently overwrote any item whose live price
-- wasn't already a multiple of 25 - e.g. the "$10" grants, hand-priced at
-- 160px at some point after the catalog's own formula (0062) already put them
-- at 150px, got forced back down to 150px, quietly erasing that manual
-- adjustment. Accuracy against whatever the price actually is beats forcing
-- everything onto a grid.
-- An item with config_options (0058_shop_item_configurator.sql: Framework
-- 13/16 DIY, GTA6 editions, etc.) is NOT a plain price either - base_price and
-- every groups[].choices[].price in there are precise pixel deltas converted
-- straight from a real vendor $ price, handled the same plain-round way. The
-- plain `price` column on a configurator item is then re-synced to the new
-- base_price, same invariant 0058 stated ("keep the flat price column in sync
-- with base_price").
--
-- pixorpheus must NOT announce this as a bulk shop price change, so the shop
-- price update runs with session_replication_role = replica, same as 0104.
--
-- ⚠️  NOT idempotent - re-running compounds the rescale (0.7 on top of 0.7).
--     Run it EXACTLY ONCE, and only once packages/config/pixl.json's
--     pixelValueUsd is actually deployed as 0.10 everywhere.
-- Run in psql against the orchard/CNPG database (the DB of record - NOT
-- Supabase, that stack is retired).

BEGIN;

DO $$
BEGIN
  SET LOCAL session_replication_role = replica;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'cannot set session_replication_role; shop change trigger is absent anyway';
END
$$;

-- ── Configurator items: base_price + every choice's price delta, in place ──
DO $$
DECLARE
  v_item RECORD;
  v_new_groups jsonb;
  v_new_config jsonb;
BEGIN
  FOR v_item IN SELECT id, config_options FROM shop_items WHERE config_options IS NOT NULL LOOP
    SELECT jsonb_agg(
      CASE WHEN grp ? 'choices' THEN
        jsonb_set(grp, '{choices}', (
          SELECT jsonb_agg(
            CASE WHEN choice ? 'price' THEN
              jsonb_set(choice, '{price}', to_jsonb(round((choice->>'price')::numeric * 0.7)))
            ELSE choice END
          )
          FROM jsonb_array_elements(grp->'choices') AS choice
        ))
      ELSE grp END
    )
    INTO v_new_groups
    FROM jsonb_array_elements(v_item.config_options->'groups') AS grp;

    v_new_config := v_item.config_options;
    IF v_new_config ? 'base_price' THEN
      v_new_config := jsonb_set(v_new_config, '{base_price}',
        to_jsonb(round((v_new_config->>'base_price')::numeric * 0.7)));
    END IF;
    IF v_new_config ? 'groups' THEN
      v_new_config := jsonb_set(v_new_config, '{groups}', coalesce(v_new_groups, '[]'::jsonb));
    END IF;

    UPDATE shop_items
    SET config_options = v_new_config,
        price = coalesce((v_new_config->>'base_price')::int, price)
    WHERE id = v_item.id;
  END LOOP;
END
$$;

-- ── Shop catalog: every plain (non-configurator) item/region ────────────────
UPDATE shop_items
SET price = round(price * 0.7)::int
WHERE price > 0 AND config_options IS NULL;

-- ── Player balances ─────────────────────────────────────────────────────────
UPDATE users
SET pixels = round(pixels * 0.7)
WHERE pixels <> 0;

-- ── Full pixel ledger: every historical credit/debit, so a project's shown
--    "pixels earned" and the shop/fulfillment/referral history all stay in
--    the same units as the rescaled balance above ───────────────────────────
UPDATE pixel_transactions
SET amount = round(amount * 0.7)
WHERE amount <> 0;

-- ── Historical shop orders: the pixel price actually deducted at purchase
--    time (configurator price included - it was already resolved to a flat
--    number at purchase time), and any flat fulfillment payout already
--    stamped on the order ───────────────────────────────────────────────────
UPDATE shop_orders
SET price = round(price * 0.7)
WHERE price <> 0;

UPDATE shop_orders
SET fulfillment_pixels_paid = round(fulfillment_pixels_paid * 0.7)
WHERE fulfillment_pixels_paid <> 0;

-- ── Referral rewards already paid out ────────────────────────────────────────
UPDATE referrals
SET reward_pixels = round(reward_pixels * 0.7)
WHERE reward_pixels IS NOT NULL AND reward_pixels <> 0;

-- ── Trial ships still awaiting the player's prize-vs-pixels choice: the held
--    amount was computed at approval time under the old rate ───────────────
UPDATE projects
SET trial_held_px = round(trial_held_px * 0.7)
WHERE trial_held_px <> 0;

UPDATE projects
SET trial_prize_px = round(trial_prize_px * 0.7)
WHERE trial_prize_px <> 0;

COMMIT;
