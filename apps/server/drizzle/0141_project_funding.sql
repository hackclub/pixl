-- Hardware-only funding request: a builder can ask for money toward their
-- build (parts, shipping) alongside the normal ship flow. Gated to kind =
-- 'hardware' at the application layer (parseProjectBody), not by a CHECK
-- here, since kind can change on an unshipped draft.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS needs_funding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS funding_usd numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bom_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cart_screenshot_urls text[] NOT NULL DEFAULT '{}';
