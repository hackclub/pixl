-- Tracks whether users.region is still the untouched default ('US', the
-- column's own DEFAULT) or something a player explicitly picked from the
-- shop's region switcher. Without this, a real address-based guess could
-- never safely override the ~80% of rows currently sitting on that default,
-- since a genuine "I chose US" and "never touched it" both just read 'US'.
--
-- true = safe to recompute from address_country each time (see regionFor in
-- routes/shop.ts). false = a player explicitly chose region, keep it as-is.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE users ADD COLUMN IF NOT EXISTS region_auto BOOLEAN NOT NULL DEFAULT true;
