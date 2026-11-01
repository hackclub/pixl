import { sql } from "./pgCompat";

export interface OrderSearchOptions {
  claimedBySlack?: string;
  stages?: string[];
  viewerSlack?: string;
  allowPrivateNames?: boolean;
  offset?: number;
}

export async function searchShopOrders(
  status: string | undefined,
  search: string,
  limit: number,
  opts: OrderSearchOptions = {},
  client: typeof sql = sql,
) {
  const q = `%${search.trim()}%`;
  const stage = status ?? "";
  const owner = opts.claimedBySlack ?? "";
  const stages = opts.stages ?? [];
  return client`select o.* from shop_orders o
    left join users u on u.id = o.user_id
    where (${stage} = '' or (${stage} = 'flagged' and o.flagged_at is not null)
      or (${stage} <> 'flagged' and o.status = ${stage}))
      and (${owner} = '' or o.claimed_by_slack = ${owner})
      and (cardinality(${stages}::text[]) = 0 or o.status = any(${stages}::text[]))
      and (
        o.item_name ilike ${q}
        or coalesce(o.option, '') ilike ${q}
        or coalesce(u.display_name, '') ilike ${q}
        or coalesce(u.slack_id, '') ilike ${q}
        or ((${opts.allowPrivateNames === true} or o.claimed_by_slack = ${opts.viewerSlack ?? ""})
          and coalesce(u.real_name, '') ilike ${q})
        or exists (
          select 1 from projects p where p.user_id = o.user_id
            and (p.name ilike ${q} or coalesce(p.repo_url, '') ilike ${q})
        )
      )
    order by o.created_at desc, o.id desc
    limit ${limit} offset ${opts.offset ?? 0}`;
}
