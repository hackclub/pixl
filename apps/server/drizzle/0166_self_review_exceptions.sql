-- Lets a specific reviewer be temporarily exempted from the "can't first-pass
-- your own project" guard (isOwnProject in apps/dashboard/app/actions.ts) -
-- e.g. a trusted reviewer who's also shipping projects, granted for a bounded
-- window rather than permanently. Deliberately narrow: this only lifts the
-- FIRST-PASS PROPOSAL block. It does not touch the separate ownership-based
-- payout gate (`!own` before recordSettledPayout) or the "different reviewer
-- must do the final pass" check, so a project this reviewer first-passes on
-- themselves still requires an independent final reviewer to confirm and
-- settle any payout - self-approval-and-payout in one step stays impossible.
CREATE TABLE IF NOT EXISTS self_review_exceptions (
  slack_id text PRIMARY KEY,
  granted_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
