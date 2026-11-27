-- Slack ts of the public #pixl-checkpoint post that announced this verdict, so
-- reviewers can jump from a past review to the thread where the player replied.
-- Null for verdicts that were never posted (bans, owner reviews, Pixo offline).
alter table review_audits add column if not exists slack_thread_ts text;
