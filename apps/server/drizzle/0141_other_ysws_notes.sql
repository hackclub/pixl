-- What the player changed since a submission they disclosed to another
-- Hack Club YSWS, alongside the existing other_ysws boolean.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "other_ysws_notes" text NOT NULL DEFAULT '';
