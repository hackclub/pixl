-- Atomic referral settlement: a claimed referral must never be left unpaid.
-- Referrer row lock serializes separate referrals from the same user so
-- the every-N referral milestone is granted precisely once.
create or replace function settle_referral_reward_atomic(
  p_referral_id bigint,
  p_project_id bigint,
  p_reward_tier text,
  p_pixels integer,
  p_milestone_every integer,
  p_milestone_pixels integer,
  p_created_by text
) returns integer
language plpgsql
as $$
declare
  referrer uuid;
  claimed_referrer uuid;
  rewarded_count integer;
begin
  if p_pixels <= 0 or p_reward_tier is null or p_reward_tier = ''
     or p_milestone_every <= 0 or p_milestone_pixels < 0 then
    raise exception 'invalid referral settlement amounts' using errcode='check_violation';
  end if;
  select referrer_id into referrer from referrals where id=p_referral_id;
  if referrer is null then return 0; end if;

  -- Always lock referrer BEFORE claiming the referral. This serializes
  -- separate referrals and makes milestone counts monotonic.
  perform 1 from users where id=referrer for update;
  if not found then raise exception 'referrer missing' using errcode='foreign_key_violation'; end if;

  update referrals set rewarded_at=now(), reward_tier=p_reward_tier,
    reward_pixels=p_pixels, reward_project_id=p_project_id
  where id=p_referral_id and referrer_id=referrer and rewarded_at is null
  returning referrer_id into claimed_referrer;
  if claimed_referrer is null then return 0; end if;

  perform adjust_user_pixels(referrer,p_pixels,'referral_reward',p_created_by);
  select count(*)::integer into rewarded_count
    from referrals where referrer_id=referrer and rewarded_at is not null;
  if rewarded_count % p_milestone_every=0 and p_milestone_pixels>0 then
    perform adjust_user_pixels(referrer,p_milestone_pixels,'referral_milestone',p_created_by);
  end if;
  return rewarded_count;
end;
$$;
