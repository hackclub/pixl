-- Shared review-form draft (technical features, hackatime evidence, notes,
-- deflation reason, note-to-player, hours/tier) - apps/dashboard's ReviewForm
-- used to only autosave this to the editing browser's own localStorage, so a
-- super spot-checking a second_review project (see Spot check tab,
-- 0171_spot_check.sql) couldn't leave notes the real final reviewer would
-- ever see. This makes it one shared draft per project instead, last writer
-- wins, cleared the moment any real verdict is actually submitted (see
-- reviewProject in apps/dashboard/app/actions.ts).
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_draft JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_draft_by TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_draft_at TIMESTAMPTZ;
