-- Whether a hardware project has actually been physically built and can be
-- filmed working, distinct from needs_funding (a funding request happens
-- BEFORE the build exists) and from project_type=cad (a design ship that
-- never gets physically built at all). The ship-time video-demo requirement
-- now gates on this instead of unconditionally requiring a video from every
-- non-design hardware ship, which blocked funding-only requests that
-- couldn't possibly have a working video yet.
-- Target: the orchard/CNPG database. Run in psql.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS finished_build boolean NOT NULL DEFAULT false;
