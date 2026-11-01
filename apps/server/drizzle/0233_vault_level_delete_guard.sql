-- A settled vault chapter must never be deleted: its awards feed lifetime RE
-- and used to vanish through ON DELETE CASCADE. Settlement claims the level
-- (unlocked_at) before it inserts the awards, so the guard checks both.
-- Even a zero-RE settled chapter defines the next chapter's reward window;
-- deleting it would reintroduce already-counted contributions.
-- Apply explicitly with the normal server database migration process.

alter table vault_chapter_awards
  drop constraint if exists vault_chapter_awards_vault_level_id_fkey;
alter table vault_chapter_awards
  add constraint vault_chapter_awards_vault_level_id_fkey
  foreign key (vault_level_id) references vault_levels(id) on delete restrict;

create or replace function vault_levels_block_settled_delete() returns trigger
language plpgsql as $$
begin
  if old.unlocked_at is not null
     or exists (select 1 from vault_chapter_awards where vault_level_id = old.id) then
    raise exception 'vault level % is settled and cannot be deleted', old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists vault_levels_block_settled_delete on vault_levels;
create trigger vault_levels_block_settled_delete
  before delete on vault_levels
  for each row execute function vault_levels_block_settled_delete();
