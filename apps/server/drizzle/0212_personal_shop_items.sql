-- Personal shop items: an item created by an admin for ONE specific player,
-- bought once, that shows up in that player's normal shop only (whatever
-- region they are in, so no region is created for it). Used for players whose
-- region has no catalog row for what they need.
--
-- reserved_user_id marks the item as personal. It is an ordinary shop_items
-- row otherwise: price, options, image, active (the admin flips active to
-- "activate it for them"), and it flows through the normal order/fulfillment
-- pipeline. buy_shop_item below enforces:
--   * only reserved_user_id can buy it, in any region
--   * one purchase (a cancelled order frees it up again), quantity forced to 1
--   * it deactivates itself once bought, so it leaves the player's shop
--
-- The (name, region) uniqueness only makes sense for catalog items, personal
-- items may share a name with other players' items, so it becomes a partial
-- unique index that skips them.
--
-- Idempotent. Run against the orchard/CNPG database.

ALTER TABLE shop_items
  ADD COLUMN IF NOT EXISTS reserved_user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS shop_items_reserved_user_idx
  ON shop_items (reserved_user_id) WHERE reserved_user_id IS NOT NULL;

ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_name_region_unique;
CREATE UNIQUE INDEX IF NOT EXISTS shop_items_name_region_unique_idx
  ON shop_items (name, region) WHERE reserved_user_id IS NULL;

CREATE OR REPLACE FUNCTION public.buy_shop_item(p_user_id uuid, p_item_id integer, p_option text, p_config jsonb DEFAULT NULL::jsonb, p_quantity integer DEFAULT 1, p_note text DEFAULT ''::text, p_stock_choice text DEFAULT ''::text, p_buyer_region text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
declare
  v_item shop_items%rowtype;
  v_balance bigint;
  v_order_id bigint;
  v_unit_price integer;
  v_price integer;
  v_qty integer;
  v_group jsonb;
  v_choice jsonb;
  v_pick text;
  v_found boolean;
  v_key text;
  v_stock_remaining integer;
  v_discount integer;
begin
  select * into v_item from shop_items where id = p_item_id;
  if not found or not v_item.active then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;
  if coalesce(v_item.unlock_xp, 0) > 0 or v_item.price <= 0 then
    return json_build_object('ok', false, 'error', 'not_for_sale');
  end if;

  -- Personal item: nobody but its player can buy it.
  if v_item.reserved_user_id is not null and v_item.reserved_user_id <> p_user_id then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- A personal item is not tied to a region, the player sees it in their
  -- shop wherever they live.
  if v_item.region is not null
     and v_item.reserved_user_id is null
     and (p_buyer_region is null or v_item.region <> p_buyer_region) then
    return json_build_object('ok', false, 'error', 'wrong_region');
  end if;

  v_qty := case
    when v_item.reserved_user_id is not null then 1
    else greatest(1, least(999, coalesce(p_quantity, 1)))
  end;
  v_discount := greatest(0, least(100, coalesce(v_item.discount_percent, 0)));
  v_unit_price := round(v_item.price * (100 - v_discount) / 100.0)::integer;

  if v_item.config_options is not null then
    v_unit_price := round(
      coalesce((v_item.config_options->>'base_price')::integer, v_item.price) * (100 - v_discount) / 100.0
    )::integer;
    for v_group in select * from jsonb_array_elements(v_item.config_options->'groups')
    loop
      v_key := v_group->>'name';
      if v_group->>'type' = 'multi' then
        if p_config is not null and p_config->v_key is not null then
          if jsonb_typeof(p_config->v_key) <> 'array' then
            return json_build_object('ok', false, 'error', 'invalid_config', 'group', v_key);
          end if;
          for v_pick in select jsonb_array_elements_text(p_config->v_key)
          loop
            v_found := false;
            for v_choice in select * from jsonb_array_elements(v_group->'choices')
            loop
              if v_choice->>'label' = v_pick then
                v_unit_price := v_unit_price + round(
                  coalesce((v_choice->>'price')::integer, 0) * (100 - v_discount) / 100.0
                )::integer;
                v_found := true;
              end if;
            end loop;
            if not v_found then
              return json_build_object('ok', false, 'error', 'invalid_config',
                'group', v_key, 'value', v_pick);
            end if;
          end loop;
        end if;
      else
        if p_config is not null and p_config->v_key is not null
           and jsonb_typeof(p_config->v_key) <> 'string' then
          return json_build_object('ok', false, 'error', 'invalid_config', 'group', v_key);
        end if;
        v_pick := p_config->>v_key;
        v_found := false;
        for v_choice in select * from jsonb_array_elements(v_group->'choices')
        loop
          if v_choice->>'label' = v_pick then
            v_unit_price := v_unit_price + round(
              coalesce((v_choice->>'price')::integer, 0) * (100 - v_discount) / 100.0
            )::integer;
            v_found := true;
          end if;
        end loop;
        if not v_found then
          if coalesce(v_pick, '') <> '' then
            return json_build_object('ok', false, 'error', 'invalid_config',
              'group', v_key, 'value', v_pick);
          end if;
          v_choice := v_group->'choices'->0;
          v_unit_price := v_unit_price + round(
            coalesce((v_choice->>'price')::integer, 0) * (100 - v_discount) / 100.0
          )::integer;
        end if;
      end if;
    end loop;
  end if;

  v_price := v_unit_price * v_qty;

  if coalesce(p_stock_choice, '') <> '' and exists (
    select 1 from shop_option_stock where item_id = p_item_id
  ) then
    select remaining into v_stock_remaining
      from shop_option_stock
      where item_id = p_item_id and choice = p_stock_choice
      for update;
    if v_stock_remaining is null or v_stock_remaining < v_qty then
      return json_build_object('ok', false, 'error', 'sold_out',
        'remaining', coalesce(v_stock_remaining, 0));
    end if;
  else
    p_stock_choice := '';
  end if;

  select pixels into v_balance from users where id = p_user_id for update;
  if v_balance is null then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  -- One-time: checked after the buyer's row is locked, so two parallel
  -- requests from the same player can't both get past it. A cancelled order
  -- doesn't count, so a refunded personal item can be bought again.
  if v_item.reserved_user_id is not null and exists (
    select 1 from shop_orders where item_id = v_item.id and status <> 'cancelled'
  ) then
    return json_build_object('ok', false, 'error', 'already_purchased');
  end if;

  if v_balance < v_price then
    return json_build_object('ok', false, 'error', 'insufficient',
      'balance', v_balance, 'price', v_price);
  end if;

  update users set pixels = pixels - v_price where id = p_user_id
    returning pixels into v_balance;

  insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
  values (p_user_id, null, -v_price, 0, 'shop_purchase', 'shop');

  if coalesce(p_stock_choice, '') <> '' then
    update shop_option_stock set remaining = remaining - v_qty
      where item_id = p_item_id and choice = p_stock_choice;
  end if;

  insert into shop_orders (user_id, item_id, item_name, option, config, price, quantity, status, buyer_note, stock_choice)
  values (p_user_id, v_item.id, v_item.name, coalesce(p_option, ''), coalesce(p_config, '{}'::jsonb), v_price, v_qty, 'pending',
          left(coalesce(p_note, ''), 300), coalesce(p_stock_choice, ''))
  returning id into v_order_id;

  -- A personal item is single-use: take it off the player's shop now.
  if v_item.reserved_user_id is not null then
    update shop_items set active = false where id = v_item.id;
  end if;

  return json_build_object('ok', true, 'balance', v_balance,
    'order_id', v_order_id, 'item_name', v_item.name, 'price', v_price, 'quantity', v_qty);
end;
$function$;
