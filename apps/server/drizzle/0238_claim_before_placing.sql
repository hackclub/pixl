-- Claim a fulfillment order without claiming it has been purchased.
-- Reservation and funding commitment happen together under the same player
-- advisory lock as the existing place-and-claim RPC. Idempotent/concurrent safe.
-- The old claim_shop_order_with_commitment still means 'placed and claimed'.
-- Apply this migration before deploying the new Claim order button.

CREATE OR REPLACE FUNCTION reserve_shop_order_with_commitment(
  p_order_id bigint,
  p_by text,
  p_by_slack text,
  p_amount_cents integer,
  p_basis text,
  p_verified_funding_cents integer,
  p_other_committed_cents integer,
  p_enforce boolean,
  p_verdict text,
  p_policy_version text,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
  v_order shop_orders%rowtype;
  v_ledger bigint;
BEGIN
  SELECT user_id INTO v_user FROM shop_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('fulfillment:' || v_user::text, 0));

  SELECT * INTO v_order FROM shop_orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.status <> 'pending' THEN
    IF v_order.status = 'claimed' AND v_order.claimed_by_slack = p_by_slack
       AND EXISTS (SELECT 1 FROM fulfillment_commitments WHERE order_id = p_order_id) THEN
      RETURN jsonb_build_object('ok', true, 'code', 'already_claimed');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'not_pending');
  END IF;

  IF p_enforce THEN
    IF p_verdict <> 'covered' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_covered');
    END IF;
    SELECT coalesce(sum(c.amount_cents), 0) INTO v_ledger
      FROM fulfillment_commitments c
      JOIN shop_orders o ON o.id = c.order_id
      WHERE c.user_id = v_user AND c.order_id <> p_order_id AND o.status <> 'cancelled';
    IF v_ledger + p_other_committed_cents + p_amount_cents > p_verified_funding_cents THEN
      RETURN jsonb_build_object('ok', false, 'code', 'insufficient');
    END IF;
  END IF;

  INSERT INTO fulfillment_commitments (
    order_id, user_id, amount_cents, basis, verified_funding_cents, verdict,
    policy_version, evidence, authorized_by, authorized_by_slack
  ) VALUES (
    p_order_id, v_user, p_amount_cents, p_basis, p_verified_funding_cents, p_verdict,
    p_policy_version, coalesce(p_evidence, '{}'::jsonb), p_by, p_by_slack
  ) ON CONFLICT (order_id) DO NOTHING;

  UPDATE shop_orders
    SET status = 'claimed',
        claimed_by = p_by,
        claimed_by_slack = p_by_slack,
        claimed_at = now(),
        ordered_at = NULL
    WHERE id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'code', 'claimed');
END;
$$;


-- Owners can also refund a reserved, not-yet-purchased order.
CREATE OR REPLACE FUNCTION cancel_claimed_shop_order(p_order_id bigint, p_by text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_order shop_orders%rowtype;
  v_refund integer;
BEGIN
  SELECT * INTO v_order FROM shop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('claimed', 'ordered', 'credited') THEN
    RETURN 0;
  END IF;

  v_refund := v_order.price;
  IF v_refund = 0 THEN
    SELECT trial_prize_px INTO v_refund
      FROM projects WHERE trial_prize_order_id = p_order_id;
    v_refund := coalesce(v_refund, 0);
  END IF;

  UPDATE shop_orders
    SET status = 'cancelled', fulfilled_at = now(), fulfilled_by = p_by
    WHERE id = p_order_id;

  UPDATE users SET pixels = pixels + v_refund WHERE id = v_order.user_id;

  INSERT INTO pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
  VALUES (v_order.user_id, NULL, v_refund, 0, 'shop_refund', p_by);

  IF coalesce(v_order.stock_choice, '') <> '' THEN
    UPDATE shop_option_stock SET remaining = remaining + v_order.quantity
      WHERE item_id = v_order.item_id AND choice = v_order.stock_choice;
  END IF;

  RETURN v_refund;
END;
$$;
