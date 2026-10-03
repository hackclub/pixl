-- A reviewer requesting changes can opt in to a Slack DM when the maker ships
-- the project again, so the person who remembers it can re-review it fast.
-- Holds that reviewer's Slack ID; cleared on the next ship.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "notify_reviewer_slack_id" text NOT NULL DEFAULT '';
