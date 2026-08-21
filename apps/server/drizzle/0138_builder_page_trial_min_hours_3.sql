-- Lowers the min-hours gate on "Raise your Builder Page" (id 2, the starter
-- Trial in The Hub) from 4h to 3h.
--
-- NOT idempotent - run once.
-- Target: the orchard/CNPG database. Run in psql.

UPDATE sidequests SET min_hours = 3 WHERE id = 2 AND name = 'Raise your Builder Page';
