-- Signal project notifications to src/littleGuy.ts, which forwards them to the
-- Little Guy relay (a desktop pet that pops them up for players who linked it).
--
-- Plain pg_notify, no extension and no secret in the database: apps/server
-- LISTENs on 'little_guy', signs each payload with LITTLE_GUY_API_KEY and does
-- the HTTP call itself. NOTIFY is only delivered on commit, and is dropped if
-- nothing is listening - acceptable here, the player's pixl inbox still has it.
--
-- Two sources:
--   1. INSERT into notifications with one of the project titles below - every
--      existing call site (dashboard actions, server routes) is covered without
--      touching them. Anything else (friends, referrals, shop, chat warnings,
--      account bans) is ignored.
--   2. a reviewer picking up a project (projects.reviewing_by going from empty
--      or another reviewer to someone), sent to the owner and accepted
--      collaborators.
--
-- Only the title, a coarse kind and the project name leave the database -
-- never the notification body (reviewer notes, ban reasons) and never
-- reviewing_by (the reviewer's Slack ID). Players without a slack_id are
-- skipped.
--
-- Safe to re-run: functions and triggers are replaced in place.

CREATE OR REPLACE FUNCTION public.little_guy_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sid text;
  kind text;
BEGIN
  -- Keyed off the titles the call sites use today; a new or renamed title is
  -- not forwarded until it's added here.
  kind := CASE NEW.title
    WHEN 'First pass complete!' THEN 'approved'
    WHEN 'Project approved!' THEN 'approved'
    WHEN 'Operation Blackout approved' THEN 'approved'
    WHEN 'Changes requested' THEN 'changes'
    WHEN 'Operation Blackout: fix window' THEN 'changes'
    WHEN 'Project rejected' THEN 'changes'
    WHEN 'Project back in review' THEN 'reviewing'
    WHEN 'Project banned' THEN 'ban'
    WHEN 'Project ban lifted' THEN 'restored'
    WHEN 'Project restored' THEN 'restored'
    WHEN 'Project hours corrected' THEN 'info'
    ELSE NULL
  END;
  IF kind IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT slack_id INTO sid FROM public.users WHERE id = NEW.user_id;
  IF sid IS NULL OR sid = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_notify('little_guy', jsonb_build_object(
    'id',        'n:' || NEW.id,
    'slack_ids', jsonb_build_array(sid),
    'kind',      kind,
    'title',     NEW.title,
    -- every project notification body quotes the project name first
    'project',   left(substring(NEW.body from '"([^"]+)"'), 80)
  )::text);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.little_guy_review_claim()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ids jsonb;
BEGIN
  SELECT jsonb_agg(DISTINCT u.slack_id) INTO ids
  FROM public.users u
  WHERE u.slack_id IS NOT NULL AND u.slack_id <> ''
    AND (u.id = NEW.user_id OR u.id IN (
      SELECT pc.user_id FROM public.project_collaborators pc
      WHERE pc.project_id = NEW.id AND pc.status = 'accepted'
    ));
  IF ids IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_notify('little_guy', jsonb_build_object(
    'id',        'r:' || NEW.id || ':' || coalesce(extract(epoch from NEW.reviewing_at)::bigint, 0),
    'slack_ids', ids,
    'kind',      'reviewing',
    'title',     'Your project is being reviewed',
    'project',   left(NEW.name, 80)
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notifications_little_guy ON public.notifications;
CREATE TRIGGER notifications_little_guy
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.little_guy_notification();

-- heartbeats only touch reviewing_at, and a reviewer re-opening their own
-- claim writes the same reviewing_by, so neither re-fires this
DROP TRIGGER IF EXISTS projects_little_guy_review ON public.projects;
CREATE TRIGGER projects_little_guy_review
AFTER UPDATE OF reviewing_by ON public.projects
FOR EACH ROW
WHEN (NEW.reviewing_by <> '' AND NEW.reviewing_by IS DISTINCT FROM OLD.reviewing_by)
EXECUTE FUNCTION public.little_guy_review_claim();
