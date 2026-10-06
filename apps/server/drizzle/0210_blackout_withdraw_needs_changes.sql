-- Let a player opt a project out of an operation while its entry sits in
-- needs_changes, not only before the first ship. A needs_changes entry has
-- no reviewer decision (operation_request_changes clears it) and nothing
-- settled on it, and a reship moves it straight back to 'shipped', so this
-- can never pull an entry out from under an in-flight review or a payout.
-- The settled_at guard is belt-and-braces against a contributor row that
-- somehow settled anyway.
--
-- Unlike the pre-ship withdraw, this one is audited: the entry has review
-- history worth keeping, and operation_audit.entry_id goes NULL on delete,
-- so the project id rides along in detail.
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION operation_withdraw(
  p_slug text, p_project_id bigint, p_user_id uuid
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
BEGIN
  SELECT e.* INTO ent FROM operation_entries e JOIN operations o ON o.id = e.operation_id
   WHERE o.slug = p_slug AND e.project_id = p_project_id AND e.user_id = p_user_id
   FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'cannot_withdraw');
  END IF;

  IF NOT (
    (ent.status = 'entered' AND ent.first_qualified_ship_at IS NULL)
    OR (ent.status = 'needs_changes' AND NOT EXISTS (
      SELECT 1 FROM operation_entry_contributors
       WHERE entry_id = ent.id AND settled_at IS NOT NULL))
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'cannot_withdraw');
  END IF;

  IF ent.status = 'needs_changes' THEN
    INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
    VALUES (ent.operation_id, ent.id, p_user_id::text, 'entry_withdrawn',
      jsonb_build_object('project_id', ent.project_id, 'status', ent.status,
        'first_qualified_ship_at', ent.first_qualified_ship_at));
  END IF;

  DELETE FROM operation_entries WHERE id = ent.id;
  RETURN json_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION operation_withdraw(text, bigint, uuid) FROM PUBLIC;

COMMIT;
