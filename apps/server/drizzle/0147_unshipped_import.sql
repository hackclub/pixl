-- Provenance for projects pulled in directly from Stardance/Macondo's own
-- public APIs (not the ships.hackclub.com registry — these haven't shipped
-- there yet either). Sibling to 0089_ysws_import.sql; same non-economy rule
-- applies, imported devlogs land as journal entries at 0 hours.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS imported_unshipped_source text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS imported_unshipped_ref text;

-- One import per source project per user.
CREATE UNIQUE INDEX IF NOT EXISTS projects_user_unshipped_ref_idx
  ON projects (user_id, imported_unshipped_source, imported_unshipped_ref)
  WHERE imported_unshipped_ref IS NOT NULL;
