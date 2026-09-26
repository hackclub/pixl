-- Follow-up to 0190_pixel_value_rescale.sql (pixelValueUsd $0.07 -> $0.10).
-- That migration's own audit (0190/0191's file history) missed three more
-- places that store a raw pixel amount, found by grepping every column
-- named like %pixel%/%_px% across the whole schema after the fact:
--
--   projects.funding_deducted_px  - pixels withheld from a hardware
--     project's payout for its funding grant, frozen at approval time
--     (0154_funding_deducted_px.sql), same category as trial_held_px /
--     trial_prize_px on the same table, which 0190 already handled - this
--     sibling column just got left out.
--
--   review_payout_settings.approved_pixels / needs_changes_pixels - the
--     admin-configured reviewer payout rate (0162_review_payout_settings.sql).
--     Currently 6px/3px, set by Gabin on 2026-09-16 under the old $0.07 rate
--     (intended as $0.42/$0.21) - nothing in 0190 touched it, so it was
--     silently paying $0.60/$0.30 instead until this runs.
--
--   review_payouts.full_pixels / paid_pixels - historical per-review payout
--     bookkeeping (0028_review_payouts.sql), parallel to the actual
--     wallet-affecting pixel_transactions rows 0190 already rescaled, same
--     category as shop_orders.price/fulfillment_pixels_paid.
--
-- Also checked and found nothing to do: bounty_claims.pixels and
-- operation_entry_contributors.gross_px/uplift_px are real pixel-bearing
-- columns too, but both are entirely empty (Operation Blackout and the
-- bounty event type have never actually been used) - nothing to rescale.
-- users has no stored RE/level column at all (always computed live from
-- projects + vault_chapter_awards), so RE/leveling was never at risk from
-- this rate change in the first place.
--
-- Same 0.7 factor, same plain round() (no grid-snap - see
-- c6cd7a8, drop the 25px grid-snap from the pixel-value rescale migrations).
--
-- ⚠️  NOT idempotent - re-running compounds the rescale.
--     Only run this if 0190 already ran and this file's columns were never
--     touched by it (true for every deploy up to and including this one).
-- Run in psql against the orchard/CNPG database.

BEGIN;

UPDATE projects
SET funding_deducted_px = round(funding_deducted_px * 0.7)
WHERE funding_deducted_px <> 0;

UPDATE review_payout_settings
SET approved_pixels = round(approved_pixels * 0.7),
    needs_changes_pixels = round(needs_changes_pixels * 0.7),
    updated_by = 'system (pixel-value rescale correction)',
    updated_at = now()
WHERE id = 1;

UPDATE review_payouts
SET full_pixels = round(full_pixels * 0.7),
    paid_pixels = round(paid_pixels * 0.7)
WHERE full_pixels <> 0 OR paid_pixels <> 0;

COMMIT;
