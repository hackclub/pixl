-- Replaces the in-memory CDN upload quota (cdnQuota.ts) with a real,
-- persistent, per-user budget. The in-memory version reset on every deploy
-- and was per-process, so it was never actually a cumulative account quota,
-- just a same-process speed bump. This is a real row per user, locked with
-- `for update` the same way buy_shop_item locks a balance, so two concurrent
-- uploads from the same account (or the same account hitting two different
-- server instances) can't both pass a check only one of them should.
--
-- Target: the orchard/CNPG database. Idempotent: CREATE OR REPLACE + REVOKE.
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS cdn_upload_quota (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requests integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0,
  window_resets_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed-window budget, same semantics as the in-memory version it replaces:
-- max requests and max bytes over a rolling window that resets p_window_seconds
-- after the first request in it. Reserves before the caller does anything
-- expensive (moderation, the CDN upload itself) - the caller must call
-- release_cdn_upload_quota if the reserved upload never actually lands.
CREATE OR REPLACE FUNCTION public.reserve_cdn_upload_quota(
  p_user_id uuid,
  p_bytes bigint,
  p_max_requests integer,
  p_max_bytes bigint,
  p_window_seconds integer
) RETURNS json
LANGUAGE plpgsql
AS $function$
declare
  v_requests integer;
  v_bytes bigint;
  v_resets_at timestamptz;
begin
  insert into cdn_upload_quota (user_id, requests, bytes, window_resets_at)
  values (p_user_id, 0, 0, now() + make_interval(secs => p_window_seconds))
  on conflict (user_id) do nothing;

  select requests, bytes, window_resets_at into v_requests, v_bytes, v_resets_at
    from cdn_upload_quota where user_id = p_user_id for update;

  if v_resets_at <= now() then
    v_requests := 0;
    v_bytes := 0;
    v_resets_at := now() + make_interval(secs => p_window_seconds);
  end if;

  if v_requests + 1 > p_max_requests or v_bytes + p_bytes > p_max_bytes then
    update cdn_upload_quota
      set requests = v_requests, bytes = v_bytes, window_resets_at = v_resets_at
      where user_id = p_user_id;
    return json_build_object(
      'ok', false,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_resets_at - now())))::integer)
    );
  end if;

  update cdn_upload_quota
    set requests = v_requests + 1, bytes = v_bytes + p_bytes, window_resets_at = v_resets_at
    where user_id = p_user_id;

  return json_build_object('ok', true);
end;
$function$;

-- Gives back a reservation that never actually turned into a stored upload
-- (moderation rejected it, the CDN call failed). No lock needed - a single
-- UPDATE is already atomic per row.
CREATE OR REPLACE FUNCTION public.release_cdn_upload_quota(
  p_user_id uuid,
  p_bytes bigint
) RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  update cdn_upload_quota
    set requests = greatest(0, requests - 1), bytes = greatest(0, bytes - p_bytes)
    where user_id = p_user_id;
end;
$function$;

-- ── Grant hygiene, same as buy_shop_item: not PUBLIC-executable ──
REVOKE EXECUTE ON FUNCTION public.reserve_cdn_upload_quota(uuid, bigint, integer, bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_cdn_upload_quota(uuid, bigint) FROM PUBLIC;

COMMIT;
