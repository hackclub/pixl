import { sql } from "../db/pgCompat.js";

export async function rankedIdeas(query: string, client: typeof sql = sql) {
  return client`
    select i.* from ideas i
    where i.banned_at is null and (${query} = '' or i.title ilike ${`%${query}%`})
    order by (
      select count(*) from idea_upvotes u where u.idea_id = i.id
    ) - (
      select count(*) from idea_downvotes d where d.idea_id = i.id
    ) desc, i.created_at desc
    limit 200
  `;
}
