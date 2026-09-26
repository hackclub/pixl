-- Emergency rollback for 0190_pixel_value_rescale.sql (pixelValueUsd $0.07 ->
-- $0.10). Multiplies every column that migration touched by the exact
-- inverse factor (1 / 0.7 = 10/7), same rounding rules, same tables.
--
-- ⚠️  READ BEFORE RUNNING: this is a mathematical inverse, not a true undo.
-- 0190 rounded every row independently, so running this back through the
-- inverse factor does not perfectly restore the pre-0190 numbers - expect the
-- same "at most a fraction of a pixel" drift 0190 already tolerated, now
-- compounded once more (round-trip through two independent roundings). It
-- also cannot undo anything that happened *because* of the new rate - any
-- shop purchase, project approval, or referral payout credited between 0190
-- landing and this running was computed at $0.10/px and stays that way.
--
-- If nothing has been credited/spent since 0190 ran, prefer restoring the
-- "pre-pixel-value-rescale-0190" database backup instead of this file - a
-- restore is exact, this is an approximation. Use this migration only when
-- real activity already happened on the new rate and a full restore would
-- throw that away too.
--
-- Running this WITHOUT ALSO reverting packages/config/pixl.json's
-- pixelValueUsd back to 0.07 (and redeploying) puts the database and the
-- running code back out of sync, the exact problem 0190 was written to fix.
-- Do both together, same as the forward migration.
--
-- ⚠️  NOT idempotent - re-running compounds the reversal.
-- Run in psql against the orchard/CNPG database.

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
              jsonb_set(choice, '{price}', to_jsonb(round((choice->>'price')::numeric * 10.0 / 7.0)))
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
        to_jsonb(round((v_new_config->>'base_price')::numeric * 10.0 / 7.0)));
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

-- ── Shop catalog: every plain (non-configurator) item/region, nearest 25px ──
UPDATE shop_items
SET price = (round(price * 10.0 / 7.0 / 25.0) * 25)::int
WHERE price > 0 AND config_options IS NULL;

-- ── Player balances ─────────────────────────────────────────────────────────
UPDATE users
SET pixels = round(pixels * 10.0 / 7.0)
WHERE pixels <> 0;

-- ── Full pixel ledger ─────────────────────────────────────────────────────────
UPDATE pixel_transactions
SET amount = round(amount * 10.0 / 7.0)
WHERE amount <> 0;

-- ── Historical shop orders ────────────────────────────────────────────────────
UPDATE shop_orders
SET price = round(price * 10.0 / 7.0)
WHERE price <> 0;

UPDATE shop_orders
SET fulfillment_pixels_paid = round(fulfillment_pixels_paid * 10.0 / 7.0)
WHERE fulfillment_pixels_paid <> 0;

-- ── Referral rewards already paid out ────────────────────────────────────────
UPDATE referrals
SET reward_pixels = round(reward_pixels * 10.0 / 7.0)
WHERE reward_pixels IS NOT NULL AND reward_pixels <> 0;

-- ── Trial ships still awaiting the player's prize-vs-pixels choice ──────────
UPDATE projects
SET trial_held_px = round(trial_held_px * 10.0 / 7.0)
WHERE trial_held_px <> 0;

UPDATE projects
SET trial_prize_px = round(trial_prize_px * 10.0 / 7.0)
WHERE trial_prize_px <> 0;

COMMIT;
