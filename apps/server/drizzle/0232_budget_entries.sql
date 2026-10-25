-- Owner-only internal budget ledger. Applying this migration requires explicit approval.
-- Monetary amounts use integer US cents; never infer funding receipts from
-- PIXL's in-game pixels. shop_orders.actual_cost_usd remains the source of
-- truth for physical fulfillment spending and must not be entered twice here.
CREATE TABLE IF NOT EXISTS budget_entries (
  id bigserial PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('income','expense')),
  category text NOT NULL CHECK (category IN (
    'program_funding','sponsorship','donation','fine_recovered','other_income',
    'contractor','security_bounty','fine_paid','reviewer_cash','hosting',
    'shipping_extra','operations','other_expense'
  )),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  state text NOT NULL DEFAULT 'settled' CHECK (state IN ('planned','settled')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 140),
  description text NOT NULL DEFAULT '',
  evidence_url text NOT NULL DEFAULT '',
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  created_by text NOT NULL CHECK (length(created_by) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  CHECK (
    (direction = 'income' AND category IN ('program_funding','sponsorship','donation','fine_recovered','other_income'))
    OR
    (direction = 'expense' AND category IN ('contractor','security_bounty','fine_paid','reviewer_cash','hosting','shipping_extra','operations','other_expense'))
  ),
  CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
      OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(void_reason)) >= 5))
);
CREATE INDEX IF NOT EXISTS budget_entries_recent_idx ON budget_entries (occurred_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS budget_entries_active_idx ON budget_entries (direction, state) WHERE voided_at IS NULL;
