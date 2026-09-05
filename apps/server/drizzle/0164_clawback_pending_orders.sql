-- Every pixel-deducting path (adjust_user_pixels, credit_project_pixels,
-- revoke_project_pixels) used to just floor the balance at 0 (or, for
-- revoke_project_pixels, not even floor at all - it could push a balance
-- negative outright). Either way, a deduction bigger than what's left in a
-- player's balance was effectively partially "lost": if they'd already spent
-- pixels on a shop order, that spend was never reconsidered, so they kept
-- an order they didn't actually have enough pixels to fully pay for once the
-- correction landed. This happened for real on 2026-09-05 (a miscalculated
-- update-ship approval clawed back 545 pixels from a player).
--
-- Fix: when a deduction would take a player's balance negative, auto-cancel
-- their pending orders (not yet claimed by a fulfiller - see the 'ordered'
-- status in claimOrder, apps/dashboard/app/actions.ts - those are already
-- physically bought and never touched here), newest first, using each
-- order's price to cover the shortfall. Any order whose price exceeds what's
-- still needed still gets fully cancelled (no partial-item cancellation),
-- but the leftover above the shortfall is refunded back as normal
-- (pixel_transactions reason 'shop_refund', matching cancel_shop_order). If
-- every pending order is exhausted and a shortfall remains, it still floors
-- at 0 - there's nothing left to reasonably recover.
--
-- Run in the Supabase SQL editor. Safe to re-run.

create or replace function claw_back_from_pending_orders(
  p_user_id uuid,
  p_shortfall bigint,
  p_by text
) returns bigint
language plpgsql
as $$
declare
  order_rec record;
  remaining_shortfall bigint := p_shortfall;
  used bigint;
  refund_amt bigint;
  total_recovered bigint := 0;
begin
  if p_shortfall <= 0 then
    return 0;
  end if;

  for order_rec in
    select id, price, item_name, stock_choice, quantity, item_id
    from shop_orders
    where user_id = p_user_id and status = 'pending'
    order by created_at desc
    for update
  loop
    exit when remaining_shortfall <= 0;

    update shop_orders
      set status = 'cancelled', fulfilled_at = now(), fulfilled_by = p_by
      where id = order_rec.id;

    if coalesce(order_rec.stock_choice, '') <> '' then
      update shop_option_stock set remaining = remaining + order_rec.quantity
      where item_id = order_rec.item_id and choice = order_rec.stock_choice;
    end if;

    used := least(order_rec.price, remaining_shortfall);
    refund_amt := order_rec.price - used;
    if refund_amt > 0 then
      update users set pixels = pixels + refund_amt where id = p_user_id;
      insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (p_user_id, null, refund_amt, 0, 'shop_refund', p_by);
    end if;

    insert into notifications (user_id, title, body)
    values (
      p_user_id,
      'Order cancelled',
      'Your "' || order_rec.item_name || '" order was cancelled because a balance correction left you without enough pixels to cover it.' ||
        case when refund_amt > 0 then ' ' || refund_amt || ' pixels were refunded.' else '' end
    );

    remaining_shortfall := remaining_shortfall - used;
    total_recovered := total_recovered + used;
  end loop;

  return total_recovered;
end;
$$;

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

  update users set pixels = greatest(pixels + delta + recovered, 0)
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

    update users set pixels = greatest(pixels + delta + recovered, 0)
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

    update users set pixels = greatest(pixels - net + recovered, 0)
    where id = p_user_id
    returning pixels into new_balance;
  end if;

  return coalesce(net, 0);
end;
$$;
