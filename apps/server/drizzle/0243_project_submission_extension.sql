-- Per-project extension of the submission deadline, granted by an owner from the
-- internal dashboard. While now() is before this time the project may be shipped
-- even though submissions have closed. Null means no extension.
alter table projects add column if not exists submission_extended_until timestamptz;
