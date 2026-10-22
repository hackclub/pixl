-- Funding commitment ledger for the fulfillment eligibility engine (see
-- apps/internal-dashboard/docs/fulfillment-eligibility.md). One row per claimed shop order: who
-- authorized it, when, the dollar amount counted against the player's eligible
-- funding, and a snapshot of the evidence and policy version it was judged on.
--
-- claim_shop_order_with_commitment flips pending -> ordered and writes the
-- ledger row in one transaction, serialized per player with an advisory lock,
-- so two fulfillers claiming different orders of the same player cannot both
-- pass a funding check against the same remaining balance. Keyed by order id,
-- so a retry is a no-op. Cancelled orders stop counting by joining on
-- shop_orders.status, so refunds need no extra write.
--
-- Not applied automatically. Run in psql against the orchard/CNPG database.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS fulfillment_commitments (
  order_id bigint PRIMARY KEY REFERENCES shop_orders(id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  basis text NOT NULL,
  verified_funding_cents integer NOT NULL,
  verdict text NOT NULL,
  policy_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  authorized_by text NOT NULL,
  authorized_by_slack text NOT NULL,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  amount_updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_commitments_user ON fulfillment_commitments(user_id);

CREATE OR REPLACE FUNCTION claim_shop_order_with_commitment(
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
    IF v_order.claimed_by_slack = p_by_slack
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
    SET status = 'ordered',
        claimed_by = p_by,
        claimed_by_slack = p_by_slack,
        claimed_at = now(),
        ordered_at = now()
    WHERE id = p_order_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'code', 'claimed');
END;
$$;

CREATE OR REPLACE FUNCTION refresh_fulfillment_commitment(
  p_order_id bigint,
  p_amount_cents integer,
  p_basis text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM fulfillment_commitments WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fulfillment:' || v_user::text, 0));
  UPDATE fulfillment_commitments
    SET amount_cents = p_amount_cents, basis = p_basis, amount_updated_at = now()
    WHERE order_id = p_order_id;
  RETURN true;
END;
$$;
