-- Closes a signup race: /auth/hackclub/callback (and /auth/demo) did a
-- select-then-insert with no DB-level guard, so two concurrent logins for the
-- same oauth identity could both miss the existing row and both insert,
-- producing two Pixl accounts for one HCA identity. This constraint is the
-- actual guard; apps/server/src/routes/auth.ts now catches the resulting
-- 23505 and logs the loser into the winner's account instead of erroring,
-- same pattern as referrals.referred_id (see drizzle/0073_referrals.sql).
--
-- Target: the orchard/CNPG database. Idempotent, safe to run more than once.
-- Will fail if duplicate (oauth_provider, oauth_id) rows already exist -
-- check for those first and resolve them before applying.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_oauth_id_key
  ON users (oauth_provider, oauth_id);

COMMIT;
