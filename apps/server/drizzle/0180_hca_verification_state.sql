-- Hack Club Auth's YSWS verification state for each player, refreshed on every
-- login (routes/auth.ts) from the basic_info scope's verification_status and
-- ysws_eligible claims. POST /api/projects/:id/ship gates on these.
--
-- NULL means never captured. Every account that predates this migration stays
-- NULL until its owner logs in again.
--
-- Apply BEFORE deploying the server that reads/writes them: new signups insert
-- these columns. Run as the app role so it owns them. Idempotent.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hca_verification_status text,
  ADD COLUMN IF NOT EXISTS hca_ysws_eligible boolean;

COMMIT;
