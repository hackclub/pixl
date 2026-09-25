-- Fixes Operation Blackout's eligibility window, which was wrongly coupled
-- to shipping/review timing instead of the operation's own clock. Logic/query
-- fix only: no schema change, no rewrite of existing operation_entries rows
-- (joined_at / window_start for already-opted-in participants are untouched).
--
-- The rule was, and stays: eligible work is
--   [max(operation.starts_at, entry.joined_at), min(now(), operation.ends_at)]
-- i.e. hour >= max(blackout_start, opted_in_at) && hour < blackout_end.
--
-- Two bugs against that rule, both in operation_record_ship:
--
-- 1. A first ship landing after ends_at (or while an admin had marked the
--    operation 'ended') was forced straight to status='ineligible', with
--    first_qualified_ship_at left NULL. That makes shipping late an
--    eligibility decision, when the spec is explicit: "the project can be
--    shipped whenever, including after Blackout ends" and "shipping ...
--    time must NOT affect which hours are eligible". A late ship must still
--    stamp normally and go to review; it simply can't have earned any hours
--    past ends_at, which the window (bug 2) already guarantees on its own.
--
-- 2. The window handed to evidence-gathering (service.ts's gatherEvidence)
--    ended at min(first_qualified_ship_at, ends_at), not min(now(), ends_at).
--    That capped eligible hours at the *ship* instant, so any work done
--    after shipping but still inside the Blackout window (e.g. continuing
--    to code before a review, or before a later plain reship) was silently
--    dropped, and conversely a ship dated after ends_at would have counted
--    hours all the way up to that late ship time instead of stopping at
--    ends_at. Evidence is (re)gathered on every ship/reship (not just the
--    first one - recordShipForOperations in service.ts re-syncs each time,
--    except once status is 'ineligible' or 'approved'), so window_end now
--    tracking min(now(), ends_at) means each reship - even one long after
--    the operation ended - picks up any previously-uncounted hours up to
--    ends_at. The one gap this doesn't close: a project that ships exactly
--    once and is never reshipped again has no later resync point; a reship
--    (even a trivial unship/reship) is what refreshes it.
--
-- Needs-changes' separate fix-window grace allowance (bounded, ratio-capped,
-- see operation_record_evidence) is unchanged by this fix.

BEGIN;

CREATE OR REPLACE FUNCTION operation_record_ship(
  p_project_id bigint, p_user_id uuid
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  op operations%ROWTYPE;
  v_now timestamptz := now();
  v_out jsonb := '[]'::jsonb;
  v_window_end timestamptz;
BEGIN
  FOR ent IN
    SELECT * FROM operation_entries
    WHERE project_id = p_project_id AND user_id = p_user_id
    ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO op FROM operations WHERE id = ent.operation_id;

    IF ent.first_qualified_ship_at IS NULL THEN
      IF ent.status = 'entered' THEN
        -- Eligibility never depends on when this lands: a ship after
        -- ends_at still qualifies and goes to review, it just can't have
        -- earned hours past ends_at (enforced below by v_window_end, not
        -- by refusing the ship).
        UPDATE operation_entries
           SET first_qualified_ship_at = v_now, latest_ship_at = v_now,
               status = 'shipped', updated_at = v_now
         WHERE id = ent.id RETURNING * INTO ent;
        INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
        VALUES (op.id, ent.id, 'system', 'first_ship',
          jsonb_build_object('at', v_now, 'window_start', ent.window_start,
            'after_operation_end', v_now > op.ends_at));
      END IF;
    ELSIF ent.status = 'needs_changes' THEN
      UPDATE operation_entries
         SET status = 'shipped', latest_ship_at = v_now, reship_count = reship_count + 1,
             eligibility_decision = NULL,
             fix_window_end = greatest(
               coalesce(fix_window_end, first_qualified_ship_at),
               least(v_now, coalesce(grace_deadline, first_qualified_ship_at))),
             updated_at = v_now
       WHERE id = ent.id RETURNING * INTO ent;
      INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
      VALUES (op.id, ent.id, 'system', 'reship_after_changes',
        jsonb_build_object('at', v_now, 'grace_deadline', ent.grace_deadline,
          'within_grace', v_now <= coalesce(ent.grace_deadline, v_now)));
    ELSE
      -- shipped/eligible/ineligible/approved: a plain re-ship changes
      -- nothing about the decision, but still refreshes latest_ship_at so
      -- window_end (below) picks up any hours worked since the last sync.
      UPDATE operation_entries SET latest_ship_at = v_now, updated_at = v_now WHERE id = ent.id
      RETURNING * INTO ent;
    END IF;

    -- The base eligibility window always ends at Blackout's own clock, never
    -- at ship time: work after ends_at never counts, but work before it
    -- counts whether the ship that surfaces it lands early, late, or (via a
    -- plain reship) long after the operation is over.
    v_window_end := CASE WHEN ent.first_qualified_ship_at IS NULL THEN NULL
                         ELSE least(v_now, op.ends_at) END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'entry_id', ent.id, 'operation_id', ent.operation_id, 'slug', op.slug,
      'status', ent.status,
      'window_start', ent.window_start,
      'window_end', v_window_end,
      'fix_window_end', ent.fix_window_end));
  END LOOP;
  RETURN json_build_object('ok', true, 'entries', v_out);
END $$;

REVOKE EXECUTE ON FUNCTION operation_record_ship(bigint, uuid) FROM PUBLIC;

COMMIT;
