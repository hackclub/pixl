-- Admin-configurable reviewer payout rates, replacing the hardcoded
-- PAYOUT_PIXELS constant in apps/dashboard/app/actions.ts. Single-row table
-- (id fixed at 1) so it reads/writes like a settings object rather than a
-- list; the app enforces there's ever only one row, this just seeds it.
--
-- approved_pixels: pixels paid for an approval (was the flat PAYOUT_PIXELS=3).
-- needs_changes_pixels: pixels paid for a "request changes" verdict - 0 by
-- default (matches today's behavior, where only approvals pay out), an admin
-- can raise this for a review push where catching real issues should count.
-- Both still go through the existing Review Blitz multiplier and the
-- rushed-review/repo-not-opened cuts, unchanged.
CREATE TABLE IF NOT EXISTS review_payout_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  approved_pixels NUMERIC NOT NULL DEFAULT 3,
  needs_changes_pixels NUMERIC NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT review_payout_settings_single_row CHECK (id = 1)
);

INSERT INTO review_payout_settings (id, approved_pixels, needs_changes_pixels)
VALUES (1, 3, 0)
ON CONFLICT (id) DO NOTHING;

-- Recorded at insert time so settleFirstPassPayouts can still mention the
-- Review Blitz bonus in its DM once a pending first-pass payout settles,
-- without needing to know what the blitz multiplier was back when the
-- pending row was created (full_pixels only stores the already-multiplied
-- total, not the pre-multiplier base).
ALTER TABLE review_payouts ADD COLUMN IF NOT EXISTS blitz_applied BOOLEAN NOT NULL DEFAULT false;
