-- Settle the Vault chapter and every winner's RE award in ONE transaction.
-- Before this migration, unlocked_at was committed before individual award
-- inserts; a failed insert left the chapter closed and winners unpaid.
create or replace function settle_vault_chapter_atomic(p_level_id bigint, p_awards jsonb)
returns boolean
language plpgsql
as $$
declare
  claimed_level bigint;
begin
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'vault award payload must be an array' using errcode='check_violation';
  end if;
  update vault_levels set unlocked_at=now()
    where id=p_level_id and unlocked_at is null
    returning id into claimed_level;
  if claimed_level is null then return false; end if;

  insert into vault_chapter_awards(vault_level_id, user_id, award_rank, re_awarded)
  select p_level_id, x.user_id, x.award_rank, x.re_awarded
  from jsonb_to_recordset(p_awards) as x(user_id uuid, award_rank smallint, re_awarded integer);
  return true;
end;
$$;
