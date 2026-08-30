-- Manual, non-Trial shop item lock: an admin can hold an item back from
-- purchase for any reason (not just "ship this Trial first"), with a note
-- explaining to players when/how it'll unlock. Same "locked" flag the client
-- already renders for Trial-gated items, just a second way to set it.
--
-- Idempotent - safe to run again, IF NOT EXISTS guards.
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS manual_locked boolean NOT NULL DEFAULT false;
ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS lock_note text NOT NULL DEFAULT '';
