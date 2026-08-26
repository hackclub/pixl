-- Top-3 chapter leaderboard rewards for the Core Vault (Slack, 2026-08-26):
-- whoever contributes the most Restoration Energy toward the *current*
-- chapter's goal gets a flat RE bonus once that chapter's level unlocks.
--
-- unlocked_at is set the first time a vault level's threshold is crossed
-- (apps/server/src/routes/vault.ts) and doubles as the boundary between one
-- chapter's contribution window and the next: a level's window runs from the
-- previous level's unlocked_at (or the beginning, for the first level) up to
-- its own unlocked_at.
alter table vault_levels add column if not exists unlocked_at timestamptz;
alter table vault_levels add column if not exists top1_re integer not null default 0;
alter table vault_levels add column if not exists top2_re integer not null default 0;
alter table vault_levels add column if not exists top3_re integer not null default 0;

-- Chapter 1's reward, as agreed in Slack: +200/+100/+50 RE for the top 3.
-- Future chapters set their own numbers by hand, same as their energy_required
-- and rewards already are.
update vault_levels set top1_re = 200, top2_re = 100, top3_re = 50 where level = 1;

create table if not exists vault_chapter_awards (
  id bigint generated always as identity primary key,
  vault_level_id bigint not null references vault_levels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  award_rank smallint not null,
  re_awarded integer not null,
  awarded_at timestamptz not null default now(),
  unique (vault_level_id, award_rank),
  unique (vault_level_id, user_id)
);

create index if not exists vault_chapter_awards_user_idx on vault_chapter_awards(user_id);
