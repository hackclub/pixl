-- Fraud review (Joe) is retired and folded into second pass: the final
-- reviewer now runs these checks themselves (Telescreen instead of Joe) and
-- ticks them off here rather than waiting on a separate automated stage.
alter table projects add column if not exists second_pass_telescreen_checked boolean not null default false;
alter table projects add column if not exists second_pass_hours_deflated boolean not null default false;
alter table projects add column if not exists second_pass_heartbeats_added boolean not null default false;
