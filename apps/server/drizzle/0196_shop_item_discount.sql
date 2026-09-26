-- Item-wide percentage discount, editable from the dashboard's /shop edit
-- form (updateShopItem in app/actions.ts, mirrored to every region row of
-- the item the same way the Trial gate / manual lock / Beacon lock already
-- are - one percentage, not a per-region price). 0 = no discount.
--
-- buy_shop_item is redefined to apply it to every price component (the base
-- price and each config_options choice) individually, with the exact same
-- rounding GET /api/shop/items uses to build the displayed price - so a
-- configurator item with add-ons still charges exactly what it showed,
-- whatever combination the player picked.
--
-- Idempotent. Run in psql against the orchard/CNPG database.

ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS discount_percent smallint NOT NULL DEFAULT 0;
ALTER TABLE shop_items DROP CONSTRAINT IF EXISTS shop_items_discount_percent_check;
ALTER TABLE shop_items ADD CONSTRAINT shop_items_discount_percent_check
  CHECK (discount_percent >= 0 AND discount_percent <= 100);

CREATE OR REPLACE FUNCTION public.buy_shop_item(
  p_user_id uuid,
  p_item_id integer,
  p_option text,
  p_config jsonb DEFAULT NULL::jsonb,
  p_quantity integer DEFAULT 1,
  p_note text DEFAULT ''::text,
  p_stock_choice text DEFAULT ''::text,
  p_buyer_region text DEFAULT NULL::text
)
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

  if v_item.region is not null
     and (p_buyer_region is null or v_item.region <> p_buyer_region) then
    return json_build_object('ok', false, 'error', 'wrong_region');
  end if;

  v_qty := greatest(1, least(999, coalesce(p_quantity, 1)));
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
        -- A multi pick must be absent/null or a JSON array. Any other shape is
        -- a tampering attempt (scalar/object that dodges the price loop).
        if p_config is not null and p_config->v_key is not null then
          if jsonb_typeof(p_config->v_key) <> 'array' then
            return json_build_object('ok', false, 'error', 'invalid_config', 'group', v_key);
          end if;
          -- Every element must be an exact known label; charge each. An
          -- unrecognized element (mis-encoded / made up) rejects the purchase,
          -- so the stored config can only ever contain shippable, paid options.
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
        -- Single pick must be absent/null or a JSON string.
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
          -- A pick was sent but matched no known label → tampering, reject.
          if coalesce(v_pick, '') <> '' then
            return json_build_object('ok', false, 'error', 'invalid_config',
              'group', v_key, 'value', v_pick);
          end if;
          -- No pick sent: charge the default (first) choice, as before.
          v_choice := v_group->'choices'->0;
          v_unit_price := v_unit_price + round(
            coalesce((v_choice->>'price')::integer, 0) * (100 - v_discount) / 100.0
          )::integer;
        end if;
      end if;
    end loop;
  end if;

  v_price := v_unit_price * v_qty;

  -- Stock-limited choice check (e.g. "Ridit" for the Signed Org Photo) —
  -- locked so two simultaneous buyers can't both grab the last unit. Only
  -- enforced for items that actually have a stock pool; a stray/bogus
  -- p_stock_choice sent for any other item is just ignored, not rejected.
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

  return json_build_object('ok', true, 'balance', v_balance,
    'order_id', v_order_id, 'item_name', v_item.name, 'price', v_price, 'quantity', v_qty);
end;
$function$;
