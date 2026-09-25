-- Operations: a generic, time-boxed campaign primitive, first user is
-- "operation-blackout" (slug). Trials (sidequests) are per-player unlockable
-- quests with a fixed prize and events (0029) are rate multipliers/bounties
-- with no per-project membership, neither has explicit project membership,
-- a reviewer eligibility decision, or a per-contributor hour ledger, so this
-- is its own small model rather than a stretched reuse of either.
--
-- Rules that matter (all enforced in the functions below, never in a client):
--   * membership is an explicit DB row (operation_entries), never inferred
--     from a title/tag, and joined_at is the database clock, not user input
--   * only work inside [max(starts_at, joined_at), min(now, ends_at)] is
--     eligible - eligibility depends solely on the operation's own clock,
--     never on when a project ships or is reviewed (see 0184's fix to
--     operation_record_ship, which originally capped this at the ship
--     instant instead); the first qualifying ship is still stamped once and
--     never reset by unship/reship, but only for bookkeeping/audit
--   * a reviewer decides eligibility + approved hours, never a dollar rate;
--     operation.rate_usd is applied on top of the contributor's own normal
--     rate according to operation.rate_mode - 'additive' means everyone gets
--     the same flat bonus (rate_usd IS the bonus, e.g. 1 for +$1/hr, not a
--     minimum); 'floor' means nobody drops below rate_usd regardless of how
--     high their own rate already is. Blackout uses 'additive': +$1/hr for
--     every eligible contributor, never a floor.
--   * pay is a per-contributor top-up over the normal project payout (the
--     normal payout already pays the hours at the player's own rate), booked
--     as its own pixel_transactions rows (reason 'operation_blackout') so it
--     is queryable by operation and never confused with 'project_approved'
--   * settlement is one transaction under an advisory lock, with a unique
--     dedupe_key on the ledger as the last line of defense against double pay
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS operations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Admin override on top of the clock: 'paused' blocks new entries,
  -- 'ended' closes it early. 'upcoming'/'active' are both just "follow the
  -- clock", see operation_effective_status().
  status text NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'ended', 'paused')),
  -- Meaning depends on rate_mode: the floor value ('floor') or the flat
  -- bonus added on top of a contributor's own rate ('additive'). Blackout:
  -- rate_mode='additive', rate_usd=1 (a flat +$1/hr, not a $1 minimum).
  rate_usd numeric(6, 2) NOT NULL DEFAULT 1 CHECK (rate_usd >= 0),
  rate_mode text NOT NULL DEFAULT 'additive' CHECK (rate_mode IN ('floor', 'additive')),
  grace_period_hours integer NOT NULL DEFAULT 72 CHECK (grace_period_hours >= 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS operation_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id bigint NOT NULL REFERENCES operations(id),
  project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'entered'
    CHECK (status IN ('entered', 'shipped', 'eligible', 'ineligible', 'approved', 'needs_changes')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- max(operation.starts_at, joined_at), frozen at join.
  window_start timestamptz NOT NULL,
  -- Stamped once, on the first ship that lands before the deadline. Never
  -- cleared or rewritten by unship/reship; it is also the end of the base
  -- eligibility window.
  first_qualified_ship_at timestamptz,
  latest_ship_at timestamptz,
  reship_count integer NOT NULL DEFAULT 0,
  -- Snapshots so an admin editing the operation later can't retroactively
  -- change an entry that is already in flight.
  rate_usd_snapshot numeric(6, 2) NOT NULL,
  rate_mode_snapshot text NOT NULL CHECK (rate_mode_snapshot IN ('floor', 'additive')),
  grace_period_hours_snapshot integer NOT NULL,
  -- Reviewer decision (human, explicit). NULL = undecided.
  eligibility_decision text CHECK (eligibility_decision IN ('eligible', 'ineligible')),
  decision_note text NOT NULL DEFAULT '',
  decided_by text NOT NULL DEFAULT '',
  decided_at timestamptz,
  decision_stage text NOT NULL DEFAULT '',
  -- Needs-changes grace: fixing work between the first ship and
  -- fix_window_end can count, capped (see operation_record_evidence).
  changes_requested_at timestamptz,
  grace_deadline timestamptz,
  fix_window_end timestamptz,
  system_reason text NOT NULL DEFAULT '',
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, project_id)
);
CREATE INDEX IF NOT EXISTS operation_entries_project_idx ON operation_entries (project_id);
CREATE INDEX IF NOT EXISTS operation_entries_status_idx ON operation_entries (operation_id, status);

-- One row per person credited on the entry (owner + accepted collaborators),
-- so a team's hours are never multiplied across members.
CREATE TABLE IF NOT EXISTS operation_entry_contributors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES operation_entries(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'collaborator')),
  -- Trusted, server-computed evidence (Hackatime spans + journal entries
  -- clipped to the entry's windows). Snapshotted at ship time.
  hackatime_base_seconds integer NOT NULL DEFAULT 0,
  journal_base_seconds integer NOT NULL DEFAULT 0,
  fix_tracked_seconds integer NOT NULL DEFAULT 0,
  eligible_tracked_seconds integer NOT NULL DEFAULT 0,
  evidence_ok boolean NOT NULL DEFAULT true,
  evidence_at timestamptz,
  -- Reviewer proposal, hard-capped by eligible_tracked_seconds on write.
  approved_blackout_hours numeric(8, 2),
  -- Settlement result (frozen once settled_at is set).
  paid_hours numeric(8, 2) NOT NULL DEFAULT 0,
  normal_usd_rate numeric(8, 4),
  effective_usd_rate numeric(8, 4),
  gross_px bigint NOT NULL DEFAULT 0,
  uplift_px bigint NOT NULL DEFAULT 0,
  settlement_no integer NOT NULL DEFAULT 0,
  settled_at timestamptz,
  settle_note text NOT NULL DEFAULT '',
  UNIQUE (entry_id, user_id)
);

-- Append-only trail of admin/system actions (schedule edits, pause, end...).
CREATE TABLE IF NOT EXISTS operation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id bigint REFERENCES operations(id),
  entry_id bigint REFERENCES operation_entries(id) ON DELETE SET NULL,
  actor text NOT NULL DEFAULT '',
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_audit_op_idx ON operation_audit (operation_id, created_at DESC);

-- Campaign attribution on the existing ledger, queryable without parsing
-- free-text reasons. dedupe_key is the hard stop against a double payout.
ALTER TABLE pixel_transactions ADD COLUMN IF NOT EXISTS operation_id bigint REFERENCES operations(id);
ALTER TABLE pixel_transactions ADD COLUMN IF NOT EXISTS meta jsonb;
ALTER TABLE pixel_transactions ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pixel_tx_dedupe_key
  ON pixel_transactions (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pixel_tx_operation_idx
  ON pixel_transactions (operation_id) WHERE operation_id IS NOT NULL;

-- ── helpers ────────────────────────────────────────────────────────────────

-- What an operation is *right now*. Never call this at review time to decide
-- eligibility, entries carry their own frozen timestamps for that.
CREATE OR REPLACE FUNCTION operation_effective_status(
  p_status text, p_starts_at timestamptz, p_ends_at timestamptz, p_now timestamptz DEFAULT now()
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_status = 'ended' THEN 'ended'
    WHEN p_now >= p_ends_at THEN 'ended'
    WHEN p_status = 'paused' THEN 'paused'
    WHEN p_now < p_starts_at THEN 'upcoming'
    ELSE 'active'
  END
$$;

-- ── join / withdraw ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION operation_join(
  p_slug text, p_project_id bigint, p_user_id uuid
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  op operations%ROWTYPE;
  proj record;
  ent operation_entries%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO op FROM operations WHERE slug = p_slug;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operation_not_found');
  END IF;

  SELECT id, user_id, status, banned_at INTO proj FROM projects WHERE id = p_project_id;
  IF NOT FOUND OR proj.user_id <> p_user_id THEN
    RETURN json_build_object('ok', false, 'error', 'project_not_found');
  END IF;

  -- Already in: hand back the row untouched. joined_at is never re-stamped.
  SELECT * INTO ent FROM operation_entries WHERE operation_id = op.id AND project_id = p_project_id;
  IF FOUND THEN
    RETURN json_build_object('ok', true, 'created', false, 'entry_id', ent.id,
      'status', ent.status, 'joined_at', ent.joined_at);
  END IF;

  IF operation_effective_status(op.status, op.starts_at, op.ends_at, v_now) <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'not_accepting_entries',
      'operation_status', operation_effective_status(op.status, op.starts_at, op.ends_at, v_now));
  END IF;
  IF proj.banned_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'project_banned');
  END IF;
  -- Joining mid-review would let a project that already shipped claim the
  -- window retroactively, so it has to be a draft, a fix-up, or an update.
  IF proj.status NOT IN ('draft', 'needs_changes', 'approved') THEN
    RETURN json_build_object('ok', false, 'error', 'project_in_review');
  END IF;

  INSERT INTO operation_entries (
    operation_id, project_id, user_id, joined_at, window_start,
    rate_usd_snapshot, rate_mode_snapshot, grace_period_hours_snapshot
  ) VALUES (
    op.id, p_project_id, p_user_id, v_now, greatest(op.starts_at, v_now),
    op.rate_usd, op.rate_mode, op.grace_period_hours
  )
  ON CONFLICT (operation_id, project_id) DO NOTHING
  RETURNING * INTO ent;

  IF ent.id IS NULL THEN
    SELECT * INTO ent FROM operation_entries WHERE operation_id = op.id AND project_id = p_project_id;
    RETURN json_build_object('ok', true, 'created', false, 'entry_id', ent.id,
      'status', ent.status, 'joined_at', ent.joined_at);
  END IF;

  INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
  VALUES (op.id, ent.id, p_user_id::text, 'entry_joined',
    jsonb_build_object('project_id', p_project_id, 'joined_at', ent.joined_at));

  RETURN json_build_object('ok', true, 'created', true, 'entry_id', ent.id,
    'status', ent.status, 'joined_at', ent.joined_at);
END $$;

-- Only an entry that has never shipped for the operation can be taken back;
-- after that the historical metadata is not the player's to erase.
CREATE OR REPLACE FUNCTION operation_withdraw(
  p_slug text, p_project_id bigint, p_user_id uuid
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_id bigint;
BEGIN
  DELETE FROM operation_entries e
  USING operations o
  WHERE o.slug = p_slug AND e.operation_id = o.id AND e.project_id = p_project_id
    AND e.user_id = p_user_id AND e.status = 'entered' AND e.first_qualified_ship_at IS NULL
  RETURNING e.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'cannot_withdraw');
  END IF;
  RETURN json_build_object('ok', true);
END $$;

-- ── ship ───────────────────────────────────────────────────────────────────

-- Called by the ship route after a ship succeeds. Stamps first_qualified_ship_at
-- exactly once (DB clock), and on a needs-changes reship keeps every original
-- timestamp and only records the reship + how far the fix window reaches.
CREATE OR REPLACE FUNCTION operation_record_ship(
  p_project_id bigint, p_user_id uuid
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  op operations%ROWTYPE;
  v_now timestamptz := now();
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR ent IN
    SELECT * FROM operation_entries
    WHERE project_id = p_project_id AND user_id = p_user_id
    ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO op FROM operations WHERE id = ent.operation_id;

    IF ent.first_qualified_ship_at IS NULL THEN
      IF ent.status = 'entered' THEN
        IF op.status <> 'ended' AND v_now <= op.ends_at THEN
          UPDATE operation_entries
             SET first_qualified_ship_at = v_now, latest_ship_at = v_now,
                 status = 'shipped', updated_at = v_now
           WHERE id = ent.id RETURNING * INTO ent;
          INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
          VALUES (op.id, ent.id, 'system', 'first_ship',
            jsonb_build_object('at', v_now, 'window_start', ent.window_start));
        ELSE
          UPDATE operation_entries
             SET status = 'ineligible', eligibility_decision = 'ineligible',
                 decided_by = 'system', decided_at = v_now,
                 system_reason = 'Shipped after the operation ended', updated_at = v_now
           WHERE id = ent.id RETURNING * INTO ent;
          INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
          VALUES (op.id, ent.id, 'system', 'missed_deadline', jsonb_build_object('at', v_now));
        END IF;
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
      -- shipped/eligible/ineligible/approved: a plain re-ship changes nothing
      -- about the historical window or the decision.
      UPDATE operation_entries SET latest_ship_at = v_now, updated_at = v_now WHERE id = ent.id
      RETURNING * INTO ent;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'entry_id', ent.id, 'operation_id', ent.operation_id, 'slug', op.slug,
      'status', ent.status,
      'window_start', ent.window_start,
      'window_end', ent.first_qualified_ship_at,
      'fix_window_end', ent.fix_window_end));
  END LOOP;
  RETURN json_build_object('ok', true, 'entries', v_out);
END $$;

-- Trusted evidence, written only by server code. The fix-hours cap is the
-- safe approximation for "reasonable requested-fix work": Pixl can't tell fix
-- work from other work in the grace period, so it is bounded to at most
-- max(config.graceFixCapMinHours, config.graceFixCapRatio * base hours),
-- defaults 1h / 25%, and a reviewer still has the last word.
CREATE OR REPLACE FUNCTION operation_record_evidence(
  p_entry_id bigint, p_rows jsonb
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  op operations%ROWTYPE;
  r record;
  v_ratio numeric;
  v_min_h numeric;
  v_base integer;
  v_fix integer;
  v_cap integer;
BEGIN
  SELECT * INTO ent FROM operation_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  SELECT * INTO op FROM operations WHERE id = ent.operation_id;
  v_ratio := coalesce((op.config->>'graceFixCapRatio')::numeric, 0.25);
  v_min_h := coalesce((op.config->>'graceFixCapMinHours')::numeric, 1);

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      user_id uuid, role text,
      hackatime_base_s integer, journal_base_s integer,
      hackatime_fix_s integer, journal_fix_s integer, evidence_ok boolean)
  LOOP
    v_base := greatest(coalesce(r.hackatime_base_s, 0), 0) + greatest(coalesce(r.journal_base_s, 0), 0);
    v_fix := greatest(coalesce(r.hackatime_fix_s, 0), 0) + greatest(coalesce(r.journal_fix_s, 0), 0);
    v_cap := greatest((v_min_h * 3600)::integer, floor(v_base * v_ratio)::integer);

    INSERT INTO operation_entry_contributors (
      entry_id, user_id, role, hackatime_base_seconds, journal_base_seconds,
      fix_tracked_seconds, eligible_tracked_seconds, evidence_ok, evidence_at
    ) VALUES (
      ent.id, r.user_id, coalesce(r.role, 'owner'),
      greatest(coalesce(r.hackatime_base_s, 0), 0), greatest(coalesce(r.journal_base_s, 0), 0),
      v_fix, v_base + least(v_fix, v_cap), coalesce(r.evidence_ok, true), now()
    )
    ON CONFLICT (entry_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      hackatime_base_seconds = EXCLUDED.hackatime_base_seconds,
      journal_base_seconds = EXCLUDED.journal_base_seconds,
      fix_tracked_seconds = EXCLUDED.fix_tracked_seconds,
      eligible_tracked_seconds = EXCLUDED.eligible_tracked_seconds,
      evidence_ok = EXCLUDED.evidence_ok,
      evidence_at = EXCLUDED.evidence_at
    WHERE operation_entry_contributors.settled_at IS NULL;
  END LOOP;
  RETURN json_build_object('ok', true);
END $$;

-- ── review ─────────────────────────────────────────────────────────────────

-- A reviewer asked for changes on a project that already shipped for the
-- operation: it keeps its eligibility and gets one grace window to fix.
CREATE OR REPLACE FUNCTION operation_request_changes(p_project_id bigint)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE operation_entries
       SET status = 'needs_changes', changes_requested_at = now(),
           grace_deadline = now() + make_interval(hours => grace_period_hours_snapshot),
           eligibility_decision = NULL, updated_at = now()
     WHERE project_id = p_project_id AND first_qualified_ship_at IS NOT NULL
       AND status IN ('shipped', 'eligible')
    RETURNING id, operation_id, grace_deadline
  ), aud AS (
    INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
    SELECT operation_id, id, 'system', 'changes_requested',
           jsonb_build_object('grace_deadline', grace_deadline) FROM upd
  ), clr AS (
    UPDATE operation_entry_contributors SET approved_blackout_hours = NULL
     WHERE entry_id IN (SELECT id FROM upd) AND settled_at IS NULL
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN json_build_object('ok', true, 'entries', v_count);
END $$;

-- The reviewer's whole Blackout input: eligible / ineligible, a reason, and
-- per-contributor approved hours. Hours are capped by the trusted evidence
-- here, so a form value can never exceed what the server measured.
CREATE OR REPLACE FUNCTION operation_review_decision(
  p_slug text, p_project_id bigint, p_decision text, p_note text,
  p_by text, p_stage text, p_hours jsonb DEFAULT '[]'::jsonb
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  h record;
  c operation_entry_contributors%ROWTYPE;
  v_max numeric;
BEGIN
  IF p_decision NOT IN ('eligible', 'ineligible') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_decision');
  END IF;
  SELECT e.* INTO ent FROM operation_entries e JOIN operations o ON o.id = e.operation_id
   WHERE o.slug = p_slug AND e.project_id = p_project_id FOR UPDATE OF e;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'no_entry');
  END IF;
  IF ent.first_qualified_ship_at IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'not_shipped_for_operation');
  END IF;
  IF ent.status NOT IN ('shipped', 'eligible', 'ineligible') THEN
    RETURN json_build_object('ok', false, 'error', 'entry_locked', 'status', ent.status);
  END IF;
  IF p_decision = 'ineligible' AND btrim(coalesce(p_note, '')) = '' THEN
    RETURN json_build_object('ok', false, 'error', 'reason_required');
  END IF;

  IF p_decision = 'eligible' THEN
    FOR h IN SELECT * FROM jsonb_to_recordset(p_hours) AS x(user_id uuid, hours numeric) LOOP
      SELECT * INTO c FROM operation_entry_contributors WHERE entry_id = ent.id AND user_id = h.user_id;
      IF NOT FOUND THEN
        RETURN json_build_object('ok', false, 'error', 'unknown_contributor', 'user_id', h.user_id);
      END IF;
      IF h.hours IS NULL OR h.hours < 0 THEN
        RETURN json_build_object('ok', false, 'error', 'invalid_hours', 'user_id', h.user_id);
      END IF;
      v_max := round(c.eligible_tracked_seconds / 3600.0, 2);
      IF round(h.hours, 2) > v_max THEN
        RETURN json_build_object('ok', false, 'error', 'exceeds_eligible',
          'user_id', h.user_id, 'max_hours', v_max);
      END IF;
    END LOOP;

    UPDATE operation_entry_contributors k
       SET approved_blackout_hours = coalesce((
         SELECT round(x.hours, 2) FROM jsonb_to_recordset(p_hours) AS x(user_id uuid, hours numeric)
          WHERE x.user_id = k.user_id LIMIT 1), 0)
     WHERE k.entry_id = ent.id AND k.settled_at IS NULL;
  ELSE
    UPDATE operation_entry_contributors SET approved_blackout_hours = 0
     WHERE entry_id = ent.id AND settled_at IS NULL;
  END IF;

  UPDATE operation_entries
     SET status = p_decision, eligibility_decision = p_decision,
         decision_note = left(coalesce(p_note, ''), 1000), decided_by = p_by,
         decided_at = now(), decision_stage = coalesce(p_stage, ''), updated_at = now()
   WHERE id = ent.id;
  INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
  VALUES (ent.operation_id, ent.id, p_by, 'review_decision',
    jsonb_build_object('decision', p_decision, 'stage', p_stage, 'note', left(coalesce(p_note, ''), 1000),
                       'hours', p_hours));
  RETURN json_build_object('ok', true, 'status', p_decision);
END $$;

-- ── settlement ─────────────────────────────────────────────────────────────

-- Final approval of the project: turns the reviewer's decision into money.
-- p_contribs: [{user_id, normal_usd_rate, credit_hours, skip_reason?}], the
-- rate/hours each person was *normally* paid on this ship, supplied by the
-- payout code that just credited them. Everything else is computed here.
--   hours   = least(approved_blackout_hours, eligible tracked hours, credit_hours)
--   eff     = entry.rate_mode_snapshot = 'additive'
--               ? normal_usd_rate + entry.rate_usd_snapshot   (Blackout: +$1/hr)
--               : greatest(normal_usd_rate, entry.rate_usd_snapshot)
--   gross   = round(hours * eff / px_value)          (the Blackout value)
--   uplift  = greatest(gross - round(hours * normal / px_value), 0)   (the top-up)
CREATE OR REPLACE FUNCTION operation_settle_entry(
  p_slug text, p_project_id bigint, p_by text, p_px_value_usd numeric, p_contribs jsonb
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  proj record;
  c operation_entry_contributors%ROWTYPE;
  x record;
  v_hours numeric;
  v_normal numeric;
  v_eff numeric;
  v_gross bigint;
  v_normal_px bigint;
  v_uplift bigint;
  v_seq integer;
  v_total bigint := 0;
  v_results jsonb := '[]'::jsonb;
  v_open integer;
BEGIN
  IF p_px_value_usd IS NULL OR p_px_value_usd <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_px_value');
  END IF;

  SELECT e.* INTO ent FROM operation_entries e JOIN operations o ON o.id = e.operation_id
   WHERE o.slug = p_slug AND e.project_id = p_project_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'none', true);
  END IF;

  -- Serialize every settlement of this entry, then take the row lock.
  PERFORM pg_advisory_xact_lock(hashtext('operation_entry:' || ent.id::text));
  SELECT * INTO ent FROM operation_entries WHERE id = ent.id FOR UPDATE;

  IF ent.status = 'approved' THEN
    RETURN json_build_object('ok', true, 'already_settled', true, 'paid_px', 0);
  END IF;
  IF ent.status = 'ineligible' THEN
    RETURN json_build_object('ok', true, 'ineligible', true, 'paid_px', 0);
  END IF;
  IF ent.status <> 'eligible' THEN
    RETURN json_build_object('ok', false, 'error', 'no_eligibility_decision', 'status', ent.status);
  END IF;

  SELECT id, status, banned_at INTO proj FROM projects WHERE id = p_project_id;
  IF NOT FOUND OR proj.status <> 'approved' OR proj.banned_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'project_not_approved');
  END IF;

  FOR c IN
    SELECT * FROM operation_entry_contributors
     WHERE entry_id = ent.id AND settled_at IS NULL ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO x FROM jsonb_to_recordset(p_contribs) AS y(
      user_id uuid, normal_usd_rate numeric, credit_hours numeric, skip_reason text)
     WHERE y.user_id = c.user_id LIMIT 1;

    v_hours := 0; v_uplift := 0; v_gross := 0; v_normal := NULL; v_eff := NULL;
    IF NOT FOUND THEN
      UPDATE operation_entry_contributors
         SET settled_at = now(), settle_note = 'not credited on the normal payout'
       WHERE id = c.id;
      CONTINUE;
    END IF;

    IF coalesce(x.skip_reason, '') <> '' THEN
      UPDATE operation_entry_contributors
         SET settled_at = now(), settle_note = left(x.skip_reason, 200)
       WHERE id = c.id;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'user_id', c.user_id, 'paid_hours', 0, 'uplift_px', 0, 'skipped', x.skip_reason));
      CONTINUE;
    END IF;

    v_hours := round(greatest(least(
      coalesce(c.approved_blackout_hours, 0),
      c.eligible_tracked_seconds / 3600.0,
      coalesce(x.credit_hours, 0)), 0), 2);
    v_normal := greatest(coalesce(x.normal_usd_rate, 0), 0);
    v_eff := CASE ent.rate_mode_snapshot
      WHEN 'additive' THEN v_normal + ent.rate_usd_snapshot
      ELSE greatest(v_normal, ent.rate_usd_snapshot)
    END;
    v_gross := round(v_hours * v_eff / p_px_value_usd);
    v_normal_px := round(v_hours * v_normal / p_px_value_usd);
    v_uplift := greatest(v_gross - v_normal_px, 0);
    v_seq := c.settlement_no + 1;

    IF v_uplift > 0 THEN
      INSERT INTO pixel_transactions (
        user_id, project_id, amount, hours, reason, created_by,
        operation_id, meta, dedupe_key
      ) VALUES (
        c.user_id, p_project_id, v_uplift, v_hours, 'operation_blackout', p_by,
        ent.operation_id,
        jsonb_build_object('entry_id', ent.id, 'hours', v_hours, 'normal_usd_rate', v_normal,
          'effective_usd_rate', v_eff, 'gross_px', v_gross, 'px_value_usd', p_px_value_usd),
        'operation_blackout:' || ent.id || ':' || c.user_id || ':' || v_seq
      );
      UPDATE users SET pixels = pixels + v_uplift WHERE id = c.user_id;
      v_total := v_total + v_uplift;
    END IF;

    UPDATE operation_entry_contributors
       SET paid_hours = v_hours, normal_usd_rate = v_normal, effective_usd_rate = v_eff,
           gross_px = v_gross, uplift_px = v_uplift, settlement_no = v_seq, settled_at = now()
     WHERE id = c.id;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'user_id', c.user_id, 'paid_hours', v_hours, 'normal_usd_rate', v_normal,
      'effective_usd_rate', v_eff, 'gross_px', v_gross, 'uplift_px', v_uplift));
  END LOOP;

  SELECT count(*) INTO v_open FROM operation_entry_contributors
   WHERE entry_id = ent.id AND settled_at IS NULL;
  IF v_open = 0 THEN
    UPDATE operation_entries SET status = 'approved', approved_at = now(), updated_at = now()
     WHERE id = ent.id;
  END IF;
  INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
  VALUES (ent.operation_id, ent.id, p_by, 'settled',
    jsonb_build_object('paid_px', v_total, 'contributors', v_results));
  RETURN json_build_object('ok', true, 'paid_px', v_total, 'contributors', v_results);
END $$;

-- The verdict was reverted (re-review): void the Blackout top-up with a
-- reversal row (the ledger keeps both) and reopen the entry for a fresh
-- decision. settlement_no keeps a later re-settlement's dedupe_key unique.
CREATE OR REPLACE FUNCTION operation_revert_entry(
  p_project_id bigint, p_by text
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  ent operation_entries%ROWTYPE;
  c operation_entry_contributors%ROWTYPE;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR ent IN
    SELECT * FROM operation_entries
     WHERE project_id = p_project_id AND status IN ('approved', 'eligible') ORDER BY id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('operation_entry:' || ent.id::text));
    FOR c IN SELECT * FROM operation_entry_contributors WHERE entry_id = ent.id ORDER BY id FOR UPDATE LOOP
      IF c.uplift_px > 0 THEN
        INSERT INTO pixel_transactions (
          user_id, project_id, amount, hours, reason, created_by, operation_id, meta, dedupe_key
        ) VALUES (
          c.user_id, p_project_id, -c.uplift_px, 0, 'operation_blackout_reverted', p_by,
          ent.operation_id, jsonb_build_object('entry_id', ent.id, 'reverts_settlement', c.settlement_no),
          'operation_blackout_reverted:' || ent.id || ':' || c.user_id || ':' || c.settlement_no
        );
        UPDATE users SET pixels = pixels - c.uplift_px WHERE id = c.user_id;
        v_out := v_out || jsonb_build_array(jsonb_build_object('user_id', c.user_id, 'reverted_px', c.uplift_px));
      END IF;
      UPDATE operation_entry_contributors
         SET settled_at = NULL, paid_hours = 0, gross_px = 0, uplift_px = 0,
             normal_usd_rate = NULL, effective_usd_rate = NULL,
             approved_blackout_hours = NULL, settle_note = ''
       WHERE id = c.id;
    END LOOP;
    UPDATE operation_entries
       SET status = 'shipped', eligibility_decision = NULL, decision_note = '',
           decided_by = '', decided_at = NULL, decision_stage = '', approved_at = NULL,
           updated_at = now()
     WHERE id = ent.id;
    INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
    VALUES (ent.operation_id, ent.id, p_by, 'reverted', jsonb_build_object('reverted', v_out));
  END LOOP;
  RETURN json_build_object('ok', true, 'reverted', v_out);
END $$;

-- A banned project can't be Blackout-eligible. Already-paid entries are left
-- alone here, same as a plain ban leaves normal pixels alone.
CREATE OR REPLACE FUNCTION operation_on_project_ban(p_project_id bigint)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  WITH upd AS (
    UPDATE operation_entries
       SET status = 'ineligible', eligibility_decision = 'ineligible', decided_by = 'system',
           decided_at = now(), system_reason = 'Project banned', updated_at = now()
     WHERE project_id = p_project_id
       AND status IN ('entered', 'shipped', 'eligible', 'needs_changes')
    RETURNING id, operation_id
  ), clr AS (
    UPDATE operation_entry_contributors SET approved_blackout_hours = 0
     WHERE entry_id IN (SELECT id FROM upd) AND settled_at IS NULL
  ), aud AS (
    INSERT INTO operation_audit (operation_id, entry_id, actor, action, detail)
    SELECT operation_id, id, 'system', 'project_banned', '{}'::jsonb FROM upd
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN json_build_object('ok', true, 'entries', v_count);
END $$;

-- ── admin ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION operation_create(
  p_slug text, p_name text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_rate_usd numeric, p_grace_hours integer, p_actor text,
  p_rate_mode text DEFAULT 'additive'
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  op operations%ROWTYPE;
BEGIN
  IF p_ends_at <= p_starts_at THEN
    RETURN json_build_object('ok', false, 'error', 'ends_before_start');
  END IF;
  IF p_rate_usd IS NULL OR p_rate_usd < 0 OR p_grace_hours IS NULL OR p_grace_hours < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_settings');
  END IF;
  IF p_rate_mode NOT IN ('floor', 'additive') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_settings');
  END IF;
  INSERT INTO operations (slug, name, starts_at, ends_at, rate_usd, rate_mode, grace_period_hours)
  VALUES (p_slug, p_name, p_starts_at, p_ends_at, p_rate_usd, p_rate_mode, p_grace_hours)
  ON CONFLICT (slug) DO NOTHING RETURNING * INTO op;
  IF op.id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'slug_taken');
  END IF;
  INSERT INTO operation_audit (operation_id, actor, action, detail)
  VALUES (op.id, p_actor, 'created', to_jsonb(op));
  RETURN json_build_object('ok', true, 'id', op.id);
END $$;

-- pause | resume | extend | end | edit. Nothing here rewrites an entry: joined_at,
-- first_qualified_ship_at, window_start and the rate snapshot are all frozen on
-- the entry itself, so a schedule change can only affect entries that have not
-- reached those moments yet.
CREATE OR REPLACE FUNCTION operation_admin_update(
  p_slug text, p_action text, p_actor text,
  p_ends_at timestamptz DEFAULT NULL, p_starts_at timestamptz DEFAULT NULL,
  p_name text DEFAULT NULL, p_rate_usd numeric DEFAULT NULL,
  p_grace_hours integer DEFAULT NULL, p_note text DEFAULT '',
  p_rate_mode text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql AS $$
DECLARE
  op operations%ROWTYPE;
  before_row jsonb;
  v_now timestamptz := now();
  v_last_ship timestamptz;
  v_entries integer;
BEGIN
  SELECT * INTO op FROM operations WHERE slug = p_slug FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operation_not_found');
  END IF;
  before_row := to_jsonb(op);
  SELECT max(first_qualified_ship_at), count(*) INTO v_last_ship, v_entries
    FROM operation_entries WHERE operation_id = op.id;

  IF p_action = 'pause' THEN
    IF op.status = 'ended' THEN RETURN json_build_object('ok', false, 'error', 'operation_ended'); END IF;
    UPDATE operations SET status = 'paused', updated_at = v_now WHERE id = op.id;
  ELSIF p_action = 'resume' THEN
    IF op.status <> 'paused' THEN RETURN json_build_object('ok', false, 'error', 'not_paused'); END IF;
    UPDATE operations SET status = 'active', updated_at = v_now WHERE id = op.id;
  ELSIF p_action = 'extend' THEN
    IF op.status = 'ended' THEN RETURN json_build_object('ok', false, 'error', 'operation_ended'); END IF;
    IF p_ends_at IS NULL OR p_ends_at <= op.ends_at THEN
      RETURN json_build_object('ok', false, 'error', 'must_extend_later');
    END IF;
    UPDATE operations SET ends_at = p_ends_at, updated_at = v_now WHERE id = op.id;
  ELSIF p_action = 'end' THEN
    IF op.status = 'ended' THEN RETURN json_build_object('ok', false, 'error', 'operation_ended'); END IF;
    UPDATE operations
       SET status = 'ended',
           ends_at = greatest(least(ends_at, v_now), starts_at + interval '1 second',
                              coalesce(v_last_ship, starts_at + interval '1 second')),
           updated_at = v_now
     WHERE id = op.id;
  ELSIF p_action = 'edit' THEN
    -- Rate / grace / name only ever apply to entries created afterwards (each
    -- entry snapshots them). The start can only move while nothing has joined.
    IF p_starts_at IS NOT NULL AND p_starts_at <> op.starts_at THEN
      IF v_entries > 0 OR v_now >= op.starts_at THEN
        RETURN json_build_object('ok', false, 'error', 'start_locked');
      END IF;
      IF p_starts_at >= op.ends_at THEN RETURN json_build_object('ok', false, 'error', 'ends_before_start'); END IF;
    END IF;
    IF p_ends_at IS NOT NULL AND p_ends_at <> op.ends_at THEN
      IF p_ends_at < op.ends_at THEN
        IF p_ends_at <= v_now OR p_ends_at < coalesce(v_last_ship, p_ends_at) THEN
          RETURN json_build_object('ok', false, 'error', 'would_cut_shipped_entries');
        END IF;
      END IF;
      IF p_ends_at <= coalesce(p_starts_at, op.starts_at) THEN
        RETURN json_build_object('ok', false, 'error', 'ends_before_start');
      END IF;
    END IF;
    IF (p_rate_usd IS NOT NULL AND p_rate_usd < 0) OR (p_grace_hours IS NOT NULL AND p_grace_hours < 0) THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_settings');
    END IF;
    IF p_rate_mode IS NOT NULL AND p_rate_mode NOT IN ('floor', 'additive') THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_settings');
    END IF;
    UPDATE operations
       SET name = coalesce(nullif(btrim(p_name), ''), name),
           starts_at = coalesce(p_starts_at, starts_at),
           ends_at = coalesce(p_ends_at, ends_at),
           rate_usd = coalesce(p_rate_usd, rate_usd),
           rate_mode = coalesce(p_rate_mode, rate_mode),
           grace_period_hours = coalesce(p_grace_hours, grace_period_hours),
           updated_at = v_now
     WHERE id = op.id;
  ELSE
    RETURN json_build_object('ok', false, 'error', 'unknown_action');
  END IF;

  SELECT * INTO op FROM operations WHERE id = op.id;
  INSERT INTO operation_audit (operation_id, actor, action, detail)
  VALUES (op.id, p_actor, 'admin_' || p_action,
    jsonb_build_object('before', before_row, 'after', to_jsonb(op), 'note', left(coalesce(p_note, ''), 500)));
  RETURN json_build_object('ok', true);
END $$;

-- ── stats ──────────────────────────────────────────────────────────────────

-- One place that answers "how is the operation doing", used by the admin view
-- and (a trimmed slice of it) the public power meter. "actual" comes straight
-- from the ledger; exposure for entries still in flight is an upper bound,
-- and is reported separately instead of being blended into a fake exact total.
CREATE OR REPLACE FUNCTION operation_stats(
  p_slug text, p_px_value_usd numeric DEFAULT 0.07, p_base_payout_usd numeric DEFAULT 4
) RETURNS json LANGUAGE plpgsql STABLE AS $$
DECLARE
  op operations%ROWTYPE;
  e json;
  k json;
  t json;
  pend json;
  v_participants integer;
  v_active integer;
BEGIN
  SELECT * INTO op FROM operations WHERE slug = p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT json_build_object(
    'entries', count(*),
    'not_shipped', count(*) FILTER (WHERE status = 'entered'),
    'shipped_entries', count(*) FILTER (WHERE first_qualified_ship_at IS NOT NULL),
    'pending_review', count(*) FILTER (WHERE status IN ('shipped', 'eligible')),
    'eligible', count(*) FILTER (WHERE status = 'eligible'),
    'ineligible', count(*) FILTER (WHERE status = 'ineligible'),
    'needs_changes', count(*) FILTER (WHERE status = 'needs_changes'),
    'approved', count(*) FILTER (WHERE status = 'approved')
  ) INTO e FROM operation_entries WHERE operation_id = op.id;

  SELECT json_build_object(
    'approved_hours', coalesce(sum(c.paid_hours) FILTER (WHERE c.settled_at IS NOT NULL), 0),
    'gross_px', coalesce(sum(c.gross_px) FILTER (WHERE c.settled_at IS NOT NULL), 0),
    'uplift_px', coalesce(sum(c.uplift_px) FILTER (WHERE c.settled_at IS NOT NULL), 0)
  ) INTO k
  FROM operation_entry_contributors c JOIN operation_entries en ON en.id = c.entry_id
  WHERE en.operation_id = op.id;

  SELECT json_build_object(
    'net_uplift_px', coalesce(sum(amount), 0),
    'paid_transactions', count(*) FILTER (WHERE reason = 'operation_blackout')
  ) INTO t
  FROM pixel_transactions
  WHERE operation_id = op.id AND reason IN ('operation_blackout', 'operation_blackout_reverted');

  -- p_base_payout_usd stands in for each in-flight contributor's real normal
  -- rate, which isn't known until settlement (see operation_settle_entry) -
  -- an assumption either way, kept only as the "gross"/work-value estimate.
  -- The additive uplift estimate needs no such assumption: the bonus is the
  -- same $ amount regardless of the contributor's real rate, so it's exact,
  -- not an upper bound, unlike the floor case (still an approximation, since
  -- a real rate already above the assumed baseline would floor to nothing).
  SELECT json_build_object(
    'hours', coalesce(sum(h), 0),
    'gross_usd', coalesce(sum(h * CASE en_mode
      WHEN 'additive' THEN p_base_payout_usd + en_rate
      ELSE greatest(p_base_payout_usd, en_rate) END), 0),
    'uplift_max_usd', coalesce(sum(h * CASE en_mode
      WHEN 'additive' THEN en_rate
      ELSE greatest(en_rate - p_base_payout_usd, 0) END), 0)
  ) INTO pend
  FROM (
    SELECT
      CASE WHEN en.status = 'eligible' AND c.approved_blackout_hours IS NOT NULL
           THEN least(c.approved_blackout_hours, c.eligible_tracked_seconds / 3600.0)
           ELSE c.eligible_tracked_seconds / 3600.0 END AS h,
      en.rate_usd_snapshot AS en_rate,
      en.rate_mode_snapshot AS en_mode
    FROM operation_entry_contributors c JOIN operation_entries en ON en.id = c.entry_id
    WHERE en.operation_id = op.id AND c.settled_at IS NULL
      AND en.status IN ('shipped', 'eligible', 'needs_changes')
  ) q;

  SELECT count(*) INTO v_participants FROM (
    SELECT user_id FROM operation_entries WHERE operation_id = op.id AND status <> 'ineligible'
    UNION
    SELECT c.user_id FROM operation_entry_contributors c JOIN operation_entries en ON en.id = c.entry_id
     WHERE en.operation_id = op.id AND en.status <> 'ineligible'
  ) u;

  SELECT count(DISTINCT j.user_id) INTO v_active
    FROM project_journals j JOIN operation_entries en ON en.project_id = j.project_id
   WHERE en.operation_id = op.id AND en.status <> 'ineligible'
     AND j.created_at >= greatest(op.starts_at, now() - interval '7 days');

  RETURN json_build_object(
    'slug', op.slug, 'entries', e, 'contributors', k, 'ledger', t, 'pending', pend,
    'participants', v_participants, 'active_builders_7d', v_active,
    'trial_held_skips', (
      SELECT count(*) FROM operation_entry_contributors c JOIN operation_entries en ON en.id = c.entry_id
       WHERE en.operation_id = op.id AND c.settle_note = 'trial_prize_hold'),
    'power_units', (k->>'approved_hours')::numeric,
    'actual_gross_usd', round(((k->>'gross_px')::numeric) * p_px_value_usd, 2),
    'actual_uplift_usd', round(((t->>'net_uplift_px')::numeric) * p_px_value_usd, 2),
    'projected_gross_usd', round(((k->>'gross_px')::numeric) * p_px_value_usd
                                 + (pend->>'gross_usd')::numeric, 2),
    'projected_uplift_max_usd', round(((t->>'net_uplift_px')::numeric) * p_px_value_usd
                                      + (pend->>'uplift_max_usd')::numeric, 2)
  );
END $$;

-- These move money and rewrite eligibility; the app connects as the owner.
-- Same grant hygiene as 0110 (buy_shop_item / adjust_user_pixels).
REVOKE EXECUTE ON FUNCTION operation_join(text, bigint, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_withdraw(text, bigint, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_record_ship(bigint, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_record_evidence(bigint, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_request_changes(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_review_decision(text, bigint, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_settle_entry(text, bigint, text, numeric, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_revert_entry(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_on_project_ban(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_create(text, text, timestamptz, timestamptz, numeric, integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION operation_admin_update(text, text, text, timestamptz, timestamptz, text, numeric, integer, text, text) FROM PUBLIC;

COMMIT;
