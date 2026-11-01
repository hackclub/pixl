-- Local materialized approval facts for the Airbridge-first fulfillment reader.
-- Only public verification fields are stored. No wallet/payment mutations.
CREATE TABLE IF NOT EXISTS fulfillment_unified_cache (
  staging_id text PRIMARY KEY CHECK (staging_id ~ '^rec[A-Za-z0-9]{14}$'),
  mapping_state text NOT NULL CHECK (mapping_state IN ('mapped', 'empty', 'missing', 'error')),
  unified_id text CHECK (unified_id IS NULL OR unified_id ~ '^rec[A-Za-z0-9]{14}$'),
  unified_state text NOT NULL CHECK (unified_state IN ('approved', 'missing', 'pending', 'error')),
  code_url text,
  approved_hours numeric(12,2) CHECK (approved_hours IS NULL OR approved_hours >= 0),
  approved_at_s bigint,
  program text,
  otter_slack_id text,
  otter_checked_ms bigint NOT NULL DEFAULT 0,
  mapping_checked_ms bigint NOT NULL DEFAULT 0,
  verified_at_ms bigint NOT NULL DEFAULT 0,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_requires_id CHECK (mapping_state <> 'mapped' OR unified_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS fulfillment_unified_cache_unified_idx ON fulfillment_unified_cache (unified_id)
  WHERE unified_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fulfillment_unified_cache_refresh_idx ON fulfillment_unified_cache (mapping_checked_ms, verified_at_ms);

CREATE TABLE IF NOT EXISTS fulfillment_unified_changes (
  id bigserial PRIMARY KEY,
  staging_id text NOT NULL,
  before_state jsonb,
  after_state jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fulfillment_unified_changes_staging_idx ON fulfillment_unified_changes (staging_id, recorded_at DESC);

CREATE OR REPLACE FUNCTION fulfillment_unified_cache_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR
    (OLD.mapping_state, OLD.unified_id, OLD.unified_state, OLD.code_url, OLD.approved_hours,
     OLD.approved_at_s, OLD.program, OLD.otter_slack_id)
    IS DISTINCT FROM
    (NEW.mapping_state, NEW.unified_id, NEW.unified_state, NEW.code_url, NEW.approved_hours,
     NEW.approved_at_s, NEW.program, NEW.otter_slack_id) THEN
    INSERT INTO fulfillment_unified_changes(staging_id, before_state, after_state)
    VALUES (
      NEW.staging_id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL
        ELSE jsonb_build_object('mapping', OLD.mapping_state, 'unified', OLD.unified_id,
          'state', OLD.unified_state, 'hours', OLD.approved_hours, 'repo', OLD.code_url,
          'approved_at', OLD.approved_at_s, 'slack', OLD.otter_slack_id)
      END,
      jsonb_build_object('mapping', NEW.mapping_state, 'unified', NEW.unified_id,
        'state', NEW.unified_state, 'hours', NEW.approved_hours, 'repo', NEW.code_url,
        'approved_at', NEW.approved_at_s, 'slack', NEW.otter_slack_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fulfillment_unified_cache_audit_trigger ON fulfillment_unified_cache;
CREATE TRIGGER fulfillment_unified_cache_audit_trigger
AFTER INSERT OR UPDATE ON fulfillment_unified_cache
FOR EACH ROW EXECUTE FUNCTION fulfillment_unified_cache_audit();

-- Lease prevents overlapping cron refreshes across dashboard replicas.
CREATE TABLE IF NOT EXISTS fulfillment_unified_sync_lease (
  id integer PRIMARY KEY CHECK (id = 1),
  token uuid,
  lease_until_ms bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO fulfillment_unified_sync_lease (id) VALUES (1) ON CONFLICT DO NOTHING;
