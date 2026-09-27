-- Support for pulling a verified legal name from Hack Club Auth's separate
-- "legal_name" scope (legal_first_name/legal_last_name on their identity
-- model) - distinct from first_name/last_name, which is a self-editable
-- display name a player could set to anything. See the one-off
-- /auth/hackclub/legal-name re-auth flow in auth.ts, used when a player's
-- first_name/last_name is obviously not their real name. Most users will
-- never have these populated; first_name/last_name/real_name remain what
-- everything else in the app reads.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_first_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_last_name text;
