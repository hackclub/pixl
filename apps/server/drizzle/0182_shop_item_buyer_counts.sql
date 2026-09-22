-- How many distinct players have bought each shop item, for the "Bought by N
-- people" line in the catalog. Cancelled orders don't count: the pixels went
-- back, so the purchase didn't happen. Counting distinct user_id (not rows)
-- means one player buying the same item three times is still one buyer.
--
-- An aggregate function rather than counting in the app: a catalog load is one
-- small grouped scan instead of pulling every shop_orders row into the server.

create index if not exists idx_shop_orders_item on shop_orders(item_id);

create or replace function shop_item_buyer_counts()
returns table (item_id integer, buyers bigint)
language sql
stable
as $$
  select o.item_id, count(distinct o.user_id) as buyers
  from shop_orders o
  where o.item_id is not null
    and o.status <> 'cancelled'
  group by o.item_id;
$$;
