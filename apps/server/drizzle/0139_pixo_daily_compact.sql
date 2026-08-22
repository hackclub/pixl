-- Pixo's "/compact" feature: an automatic end-of-day summary of #pixl,
-- generated silently and only ever shown to a player who asks for it via
-- pixo:compact. One row per channel per calendar day (in the compact job's
-- configured timezone), re-generating overwrites that day's row.
create table if not exists daily_compacts (
  id bigserial primary key,
  channel_id text not null,
  compact_date date not null,
  summary text not null,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (channel_id, compact_date)
);
