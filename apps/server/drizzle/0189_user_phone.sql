-- A player's phone number, required on their first shop order and reused
-- silently on every order after that (see /api/shop/buy/:id in
-- apps/server/src/routes/shop.ts) - fulfillers need it to actually get
-- physical prizes delivered. Encrypted at rest same as the address columns
-- on this table (see encryptPII/decryptPII in crypto.ts).
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
