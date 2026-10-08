-- 0208 backfilled first_shipped_at from the earliest review audit, which is the
-- date of the first REVIEW, not the first ship, so every project reshipped
-- before that migration showed a shorter wait than it really had (the review
-- table and the queue order both use first_shipped_at).
--
-- Every ship writes a "Project shipped" / "Update shipped" notification to the
-- maker ("<name>" is in the review queue...), so the earliest one for the same
-- user + project name is the real first ship. It must not predate the project
-- itself (a maker can reuse a name), and it only ever moves the date earlier.
--
-- Old values are kept in first_shipped_at_backup_0211 so this can be undone.
-- Idempotent. Run against the orchard/CNPG database.

CREATE TABLE IF NOT EXISTS first_shipped_at_backup_0211 AS
SELECT id, first_shipped_at, shipped_at FROM projects WHERE false;

WITH real_first AS (
  SELECT p.id,
    (SELECT MIN(n.created_at) FROM notifications n
      WHERE n.user_id = p.user_id
        AND n.title IN ('Project shipped', 'Update shipped')
        AND n.created_at >= p.created_at - interval '1 minute'
        AND left(n.body, length(p.name) + 2) = '"' || p.name || '"') AS notif
  FROM projects p
  WHERE p.shipped_at IS NOT NULL
), todo AS (
  SELECT r.id, r.notif
  FROM real_first r JOIN projects p ON p.id = r.id
  WHERE r.notif IS NOT NULL AND r.notif < COALESCE(p.first_shipped_at, p.shipped_at)
), saved AS (
  INSERT INTO first_shipped_at_backup_0211 (id, first_shipped_at, shipped_at)
  SELECT p.id, p.first_shipped_at, p.shipped_at FROM projects p JOIN todo t ON t.id = p.id
  WHERE NOT EXISTS (SELECT 1 FROM first_shipped_at_backup_0211 b WHERE b.id = p.id)
  RETURNING id
)
UPDATE projects p SET first_shipped_at = t.notif FROM todo t WHERE p.id = t.id;
