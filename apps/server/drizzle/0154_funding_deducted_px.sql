-- Tracks how many pixels were actually withheld from a hardware project's
-- approval payout for its funding grant, so the review dash and fulfillment
-- side can show what was really deducted instead of recomputing it from
-- funding_usd at read time (the px/$ rate can change after approval).
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS funding_deducted_px integer NOT NULL DEFAULT 0;
