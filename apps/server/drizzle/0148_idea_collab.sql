alter table ideas add column if not exists is_collab boolean not null default false;
alter table ideas add column if not exists roles_needed text[] not null default '{}';
alter table ideas add column if not exists hours_estimate numeric;

create index if not exists ideas_collab_idx on ideas(is_collab) where is_collab;
