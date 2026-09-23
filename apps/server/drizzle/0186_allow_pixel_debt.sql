-- Every pixel-deducting function (adjust_user_pixels, credit_project_pixels,
-- revoke_project_pixels) floored users.pixels at 0 (see
-- 0164_clawback_pending_orders.sql), even after clawing back everything
-- recoverable from pending orders. That silently ate real debt: a deduction
-- bigger than the balance plus whatever got recovered just vanished instead
-- of showing up anywhere, so "how much does this player actually owe" had no
-- answer. Now a shortfall that clawback couldn't fully cover shows up as a
-- genuine negative balance instead - the player's next credit (a ship, a
-- payout, a manual grant) pays that down automatically before their balance
-- goes positive again, since it's just normal addition once nothing floors
-- it.
--
-- The claw_back_from_pending_orders trigger condition and behavior are
-- unchanged - it still fires exactly when a deduction would take the balance
-- negative, and still cancels pending orders newest-first to cover as much
-- of the shortfall as it can. Only the final floor is removed; whatever's
-- still short after clawback now becomes real debt instead of being erased.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

create or replace function adjust_user_pixels(
  p_user_id uuid,
  p_amount numeric,
  p_reason text,
  p_created_by text
) returns numeric
language plpgsql
as $$
declare
  delta bigint;
  current_balance bigint;
  recovered bigint := 0;
  new_balance bigint;
begin
  delta := round(p_amount);
  if delta = 0 then
    select pixels into new_balance from users where id = p_user_id;
    return coalesce(new_balance, 0);
  end if;

  select pixels into current_balance from users where id = p_user_id;
  current_balance := coalesce(current_balance, 0);

  if delta < 0 and current_balance + delta < 0 then
    recovered := claw_back_from_pending_orders(p_user_id, -(current_balance + delta), p_created_by);
  end if;

  update users set pixels = pixels + delta + recovered
  where id = p_user_id
  returning pixels into new_balance;

  insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
  values (p_user_id, null, delta, 0, p_reason, p_created_by);

  return coalesce(new_balance, 0);
end;
$$;

create or replace function credit_project_pixels(
  p_user_id uuid,
  p_project_id bigint,
  p_amount numeric,
  p_hours numeric,
  p_created_by text
) returns numeric
language plpgsql
as $$
declare
  already bigint;
  delta bigint;
  current_balance bigint;
  recovered bigint := 0;
  new_balance bigint;
begin
  select coalesce(sum(amount), 0) into already
  from pixel_transactions
  where project_id = p_project_id
    and user_id = p_user_id
    and reason in ('project_approved', 'review_reverted');

  delta := round(p_amount) - already;

  if delta <> 0 then
    select pixels into current_balance from users where id = p_user_id;
    current_balance := coalesce(current_balance, 0);

    if delta < 0 and current_balance + delta < 0 then
      recovered := claw_back_from_pending_orders(p_user_id, -(current_balance + delta), p_created_by);
    end if;

    insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
    values (p_user_id, p_project_id, delta, p_hours, 'project_approved', p_created_by);

    update users set pixels = pixels + delta + recovered
    where id = p_user_id
    returning pixels into new_balance;
  else
    select pixels into new_balance from users where id = p_user_id;
  end if;

  return coalesce(new_balance, 0);
end;
$$;

create or replace function revoke_project_pixels(
  p_user_id uuid,
  p_project_id bigint,
  p_created_by text
) returns numeric
language plpgsql
as $$
declare
  net bigint;
  current_balance bigint;
  recovered bigint := 0;
  new_balance bigint;
begin
  select coalesce(sum(amount), 0) into net
  from pixel_transactions
  where project_id = p_project_id
    and user_id = p_user_id
    and reason in ('project_approved', 'review_reverted');

  if net <> 0 then
    select pixels into current_balance from users where id = p_user_id;
    current_balance := coalesce(current_balance, 0);

    if current_balance - net < 0 then
      recovered := claw_back_from_pending_orders(p_user_id, net - current_balance, p_created_by);
    end if;

    insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
    values (p_user_id, p_project_id, -net, 0, 'review_reverted', p_created_by);

    update users set pixels = pixels - net + recovered
    where id = p_user_id
    returning pixels into new_balance;
  end if;

  return coalesce(net, 0);
end;
$$;
