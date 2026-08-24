-- Player-saved shop items: a pin/bookmark so a wishlist item is easy to find
-- again, and for a configurable item (e.g. the Framework laptop), the
-- option/config picks so a saved build persists instead of resetting to the
-- first choice on every visit.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

CREATE TABLE IF NOT EXISTS shop_saves (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  option text NOT NULL DEFAULT '',
  config jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);
