-- Signed Org Photo already had its "From which org?: Gabin, Ridit, Ricky"
-- choice group (see 0095_org_photo_choice_no_limit.sql) - but only on the US
-- and INDIA region rows. The other 6 regions (AFRICA, ASIA, BANGLADESH,
-- EUROPE, NORTH_AMERICA, SOUTH_AMERICA) had an empty options array, so
-- buyers there got no choice of who signed it at all.
--
-- Idempotent (only touches rows still at the empty default). Run in psql
-- against the orchard/CNPG database.

UPDATE shop_items
SET options = '["From which org?: Gabin, Ridit, Ricky"]'::jsonb
WHERE name = 'Signed Org Photo' AND options = '[]'::jsonb;
