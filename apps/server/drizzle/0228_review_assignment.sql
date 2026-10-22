-- Reviewer assignment for the first-pass queue (see
-- apps/internal-dashboard/lib/reviewAssignment.ts).
--
-- The reviewer who first requests changes on a project is assigned to it: only
-- they (and owners) can review it again, and they approve it when the maker
-- re-ships. They have 3 days from the re-ship, after which the project goes back
-- to the common queue and the pixel held for that first request is forfeited.
--
--   assigned_reviewer_slack_id  Slack id of the assignee, '' when nobody is.
--   assigned_at                 when the changes were requested.
--   assignment_reminded_at      when the assignee was last reminded, so the
--                               reminder goes out once per window.
--
-- Not in PLAYER_PROJECT_FIELDS, so players and the public API never see these.
--
-- Target: the orchard/CNPG database. Idempotent. Run in psql.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS assigned_reviewer_slack_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignment_reminded_at timestamptz;

CREATE INDEX IF NOT EXISTS projects_assigned_reviewer_idx
  ON projects (assigned_reviewer_slack_id)
  WHERE assigned_reviewer_slack_id <> '';
