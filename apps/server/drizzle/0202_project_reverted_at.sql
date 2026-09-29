-- Tracks when a reverted review (reReviewProject in app/actions.ts) sent a
-- project back to the first-pass queue, so it can jump to the front instead
-- of sorting by its original shipped_at like every other queued project.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS reverted_at timestamptz;
