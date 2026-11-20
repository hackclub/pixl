import { Router } from "express";
import { sql } from "../db/pgCompat.js";
import { config } from "../config.generated.js";

const router = Router();

// The headline numbers the landing page shows once the program has ended.
// Deliberately unauthenticated and aggregate-only: five counts and sums, no
// per-player rows, so there is nothing here that needs a session. Cached in
// memory so a landing page traffic spike is one query per TTL, not one per
// visitor.
const TTL_MS = 5 * 60 * 1000;

interface ResultsStats {
  users: number;
  projectsCreated: number;
  projectsShipped: number;
  hoursShipped: number;
  rewardsUsd: number;
}

let cache: { at: number; stats: ResultsStats } | null = null;

async function computeStats(): Promise<ResultsStats> {
  const rows = await sql`
    select
      (select count(*) from users)::int as users,
      (select count(*) from projects where banned_at is null)::int as projects_created,
      (select count(*) from projects where status = 'approved' and banned_at is null)::int as projects_shipped,
      (select coalesce(sum(approved_hours), 0) from projects where status = 'approved' and banned_at is null)::float8 as hours_shipped,
      (select coalesce(sum(price), 0) from shop_orders where status <> 'cancelled')::float8 as order_px`;
  const r = rows[0] as Record<string, number>;
  return {
    users: Number(r.users),
    projectsCreated: Number(r.projects_created),
    projectsShipped: Number(r.projects_shipped),
    hoursShipped: Math.round(Number(r.hours_shipped)),
    // "Rewards" is the dollar value of what players actually ordered in the
    // shop (everything not cancelled), priced at the program's pixel value.
    rewardsUsd: Math.round(Number(r.order_px) * config.economy.pixelValueUsd),
  };
}

router.get("/api/results", async (_req, res) => {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      cache = { at: Date.now(), stats: await computeStats() };
    }
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({ ok: true, ...cache.stats });
  } catch (err) {
    console.error("[results] stats failed", err);
    // Serve the last good numbers rather than an error if we have any.
    if (cache) return res.json({ ok: true, ...cache.stats });
    res.status(500).json({ ok: false });
  }
});

export default router;
