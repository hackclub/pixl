-- Only users with a row here have explicitly opted in to new-order DMs from
-- Pixorpheus. Removing someone from `fulfillers` revokes the preference too.
CREATE TABLE IF NOT EXISTS fulfiller_order_alerts (
  slack_user_id text PRIMARY KEY REFERENCES fulfillers(slack_user_id) ON DELETE CASCADE,
  opted_in_at timestamptz NOT NULL DEFAULT now()
);
