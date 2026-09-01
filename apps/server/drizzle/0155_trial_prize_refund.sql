-- A Trial prize order (created in the trial-reward route when a player keeps
-- the prize instead of pixels) is stored as a $0 shop_orders row, so
-- cancelling it refunded price = 0 pixels -- nothing, even though the player
-- genuinely forfeited pixels (trial_prize_px) at review time to get it. This
-- makes cancel_shop_order refund trial_prize_px instead whenever the order's
-- price is 0 and it's linked from projects.trial_prize_order_id. Every other
-- order (price > 0) refunds exactly as before.
-- Target: the orchard/CNPG database. Run in psql.

CREATE OR REPLACE FUNCTION public.cancel_shop_order(p_order_id bigint, p_by text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_order shop_orders%rowtype;
  v_refund integer;
begin
  select * into v_order from shop_orders where id = p_order_id for update;
  if not found or v_order.status <> 'pending' then
    return 0;
  end if;

  v_refund := v_order.price;
  if v_refund = 0 then
    select trial_prize_px into v_refund
      from projects where trial_prize_order_id = p_order_id;
    v_refund := coalesce(v_refund, 0);
  end if;

  update shop_orders
    set status = 'cancelled', fulfilled_at = now(), fulfilled_by = p_by
    where id = p_order_id;

  update users set pixels = pixels + v_refund where id = v_order.user_id;

  insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
  values (v_order.user_id, null, v_refund, 0, 'shop_refund', p_by);

  if coalesce(v_order.stock_choice, '') <> '' then
    update shop_option_stock set remaining = remaining + v_order.quantity
      where item_id = v_order.item_id and choice = v_order.stock_choice;
  end if;

  return v_refund;
end;
$function$;
