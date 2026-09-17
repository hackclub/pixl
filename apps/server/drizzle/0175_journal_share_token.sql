-- Public, no-login journal link for an approved project (see
-- apps/dashboard/lib/airtable.ts's "Justification - Alternate Tracking
-- Method" field). A long random per-project token, not derived from
-- anything guessable, so it can be shared as a URL
-- (play.pixl.hackclub.com/journals/<id>/<token>) without exposing the rest
-- of the project or requiring a session. Generated lazily (see
-- ensureJournalShareToken in apps/dashboard/lib/db.ts) the first time a
-- project is pushed to Airtable, not eagerly for every project - most
-- projects never need one.
--
-- Idempotent. Safe to run more than once. Run against the orchard/CNPG
-- database.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS journal_share_token TEXT;

-- Only enforced among non-null values (a partial unique index), so the very
-- common NULL case (a project that's never had a token generated) is never
-- treated as a collision with any other NULL row.
CREATE UNIQUE INDEX IF NOT EXISTS projects_journal_share_token_key
  ON projects (journal_share_token)
  WHERE journal_share_token IS NOT NULL;
