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
  window_resets_at timestamptz NOT NULL DEFAULT now(),
  -- Bumped every time the window actually rolls over. A release must be
  -- tied to this, not to window_resets_at directly - that value is a
  -- timestamptz, and round-tripping it through JSON -> JS -> a bind
  -- parameter can lose sub-millisecond precision, which would make an
  -- exact-equality release silently match nothing (or worse, drift). An
  -- integer round-trips exactly.
  window_id bigint NOT NULL DEFAULT 0
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
  v_window_id bigint;
begin
  insert into cdn_upload_quota (user_id, requests, bytes, window_resets_at, window_id)
  values (p_user_id, 0, 0, now() + make_interval(secs => p_window_seconds), 1)
  on conflict (user_id) do nothing;

  select requests, bytes, window_resets_at, window_id
    into v_requests, v_bytes, v_resets_at, v_window_id
    from cdn_upload_quota where user_id = p_user_id for update;

  if v_resets_at <= now() then
    v_requests := 0;
    v_bytes := 0;
    v_resets_at := now() + make_interval(secs => p_window_seconds);
    v_window_id := v_window_id + 1;
  end if;

  if v_requests + 1 > p_max_requests or v_bytes + p_bytes > p_max_bytes then
    update cdn_upload_quota
      set requests = v_requests, bytes = v_bytes, window_resets_at = v_resets_at, window_id = v_window_id
      where user_id = p_user_id;
    return json_build_object(
      'ok', false,
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_resets_at - now())))::integer)
    );
  end if;

  update cdn_upload_quota
    set requests = v_requests + 1, bytes = v_bytes + p_bytes, window_resets_at = v_resets_at, window_id = v_window_id
    where user_id = p_user_id;

  -- window_id identifies the exact window this reservation was made against.
  -- The caller must pass it back to release_cdn_upload_quota so a release
  -- that arrives after the window has already rolled over can't decrement a
  -- newer window's usage instead of doing nothing.
  return json_build_object('ok', true, 'window_id', v_window_id);
end;
$function$;

DROP FUNCTION IF EXISTS public.release_cdn_upload_quota(uuid, bigint);
DROP FUNCTION IF EXISTS public.release_cdn_upload_quota(uuid, bigint, timestamptz);

-- Gives back a reservation that never actually turned into a stored upload
-- (moderation rejected it before the CDN was ever contacted, or the CDN gave
-- a definitive rejection). p_window_id must be the value
-- reserve_cdn_upload_quota returned for this reservation - if the row has
-- since moved to a different window (a later request reset it), the WHERE
-- clause matches nothing and this is a safe no-op instead of undercounting
-- whatever is using the budget now. No lock needed - a single UPDATE is
-- already atomic per row.
CREATE OR REPLACE FUNCTION public.release_cdn_upload_quota(
  p_user_id uuid,
  p_bytes bigint,
  p_window_id bigint
) RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  update cdn_upload_quota
    set requests = greatest(0, requests - 1), bytes = greatest(0, bytes - p_bytes)
    where user_id = p_user_id and window_id = p_window_id;
end;
$function$;

-- ── Grant hygiene, same as buy_shop_item: not PUBLIC-executable ──
REVOKE EXECUTE ON FUNCTION public.reserve_cdn_upload_quota(uuid, bigint, integer, bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_cdn_upload_quota(uuid, bigint, bigint) FROM PUBLIC;

COMMIT;
