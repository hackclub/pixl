-- Per-user session revocation. A session token whose iat is at or before this
-- instant (whole seconds) is rejected on HTTP and WebSocket. NULL means never
-- revoked, so every existing session stays valid until someone is revoked.
--
-- Apply BEFORE deploying the server that reads it. The server tolerates the
-- column missing (nothing is revoked, and POST /api/admin/revoke-sessions
-- answers 503), but no revocation can be recorded until this is applied.
-- Metadata-only change, no table rewrite. Run as the app role. Idempotent.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

COMMIT;
