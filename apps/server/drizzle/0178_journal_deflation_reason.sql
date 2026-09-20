-- The Journals tab's per-entry deflation ("Credit" field, see
-- 0159_journal_approved_hours.sql) required a reason but never stored it
-- anywhere the UI reads back - it only ever got embedded as free text in a
-- mod_actions log line, which the Journals tab never displays. A reviewer
-- reopening the tab always saw a blank reason box with no trace of what
-- they'd previously written, as if it had vanished. This column is the
-- actual current reason for the entry's live override, kept in sync with
-- approved_hours by app/actions.ts's setJournalHours (cleared back to NULL
-- whenever the override itself is cleared or raised back to the claimed
-- hours, since a non-deflating value has nothing to explain).
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE project_journals ADD COLUMN IF NOT EXISTS deflation_reason text;
