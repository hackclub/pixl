import { Router } from "express";
import { db } from "../db/client.js";
import { sql } from "../db/pgCompat.js";
import { activeEvents } from "../events.js";
import { approvedHoursFor, lifetimeRe, levelForRe } from "../xp.js";
import { REFERRAL_WINDOW_HOURS } from "./referral.js";

const router = Router();

// Search text is matched with ILIKE against every user/project row, so it is
// capped: nobody types a 64+ character name, and a huge pattern is pure cost.
export const MAX_SEARCH_LENGTH = 64;
export function searchText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_SEARCH_LENGTH).trim() : "";
}

// Leaderboards aggregate in SQL and return only the top rows, instead of
// reading every referral / every upvote into memory per request.
// Swappable in tests.
export const leaderboardDeps = {
  query: (text: string, params: unknown[]): Promise<Record<string, unknown>[]> =>
    sql.unsafe(text, params as never[]) as unknown as Promise<Record<string, unknown>[]>,
};
const LEADERBOARD_SIZE = 25;

// #public-safe-only, no ban_reason/review_note/system_note/airtable_record_id etc
export const PUBLIC_PROJECT_COLUMNS =
  "id, user_id, name, description, project_type, level, status, image_url, repo_url, demo_url, shipped_at, created_at, hackatime_seconds, is_peak";

// #public, no session needed - fields already safe (no slack_id/email)
router.get("/api/explore/players", async (req, res) => {
  const q = searchText(req.query.q);
  // Accounts still inside their referral window are held out of the
  // directory , sorting newest-first otherwise turns this into a lookup
  // table for finding fresh signups to DM a referral code at (see
  // apps/server/src/routes/referral.ts). They show up here as soon as that
  // window closes and there's nothing left to gain by targeting them.
  const referralSafeCutoff = new Date(Date.now() - REFERRAL_WINDOW_HOURS * 3600_000).toISOString();
  const buildQuery = (fields: string) => {
    let query = db
      .from("users")
      .select(fields)
      .lte("created_at", referralSafeCutoff)
      .order("created_at", { ascending: false })
      .limit(100);
    if (q) query = query.ilike("display_name", `%${q}%`);
    return query;
  };
  // card_pixelate arrives with migration 0030 , fall back gracefully before it.
  // slack_id is deliberately not selected , player Slack member IDs never
  // need to reach the client.
  const first = await buildQuery(
    "id, display_name, skin, created_at, avatar_url, card_pixelate",
  );
  let users = (first.data ?? null) as Record<string, unknown>[] | null;
  let error = first.error;
  if (error) {
    const second = await buildQuery(
      "id, display_name, skin, created_at, avatar_url",
    );
    users = (second.data ?? null) as Record<string, unknown>[] | null;
    error = second.error;
  }
  if (error) {
    console.error("[explore] players failed", error);
    return res.status(500).json({ ok: false });
  }

  const ids = (users ?? []).map((u) => u.id as string);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: projects } = await db
      .from("projects")
      .select("user_id")
      .is("archived_at", null)
      .is("rejected_at", null)
    .is("banned_at", null)
      .in("user_id", ids);
    for (const p of projects ?? [])
      counts.set(p.user_id as string, (counts.get(p.user_id as string) ?? 0) + 1);
  }

  res.json({
    ok: true,
    players: (users ?? []).map((u) => ({
      ...u,
      project_count: counts.get(u.id as string) ?? 0,
    })),
  });
});

// What counts as "earned" on the pixel leaderboard: approvals, bounties,
// reviewer payouts, referral rewards and fulfiller payouts, net of their own
// corrections (a deflated approval or a voided payout subtracts). Spending,
// shop refunds and manual grants or deductions are not earnings, so buying
// something never drops anyone down the board. Constants only: this list is
// inlined into the SQL.
export const EARNING_REASONS = [
  "project_approved",
  "bounty",
  "review_payout",
  "review_payout_backfill",
  "review_payout_voided",
  "review_payout_cut",
  "review_reverted",
  "referral_reward",
  "fulfillment_payout",
  "operation_blackout",
] as const;
const EARNED_CTE = `with e as (
  select user_id, sum(amount) as earned from pixel_transactions
  where reason in (${EARNING_REASONS.map((r) => `'${r}'`).join(", ")})
  group by user_id having sum(amount) > 0
)`;

// Top players by total pixels earned (not current balance, so spending in
// the shop doesn't cost anyone their rank). Read-only, aggregated in SQL.
router.get("/api/explore/leaderboard", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  let top: Record<string, unknown>[];
  let mine: Record<string, unknown>[];
  try {
    [top, mine] = await Promise.all([
      leaderboardDeps.query(
        `${EARNED_CTE} select e.user_id::text as id, u.display_name, u.skin, e.earned
         from e join users u on u.id = e.user_id order by e.earned desc, e.user_id limit $1`,
        [LEADERBOARD_SIZE],
      ),
      leaderboardDeps.query(
        `${EARNED_CTE} select e.earned, (select count(*) from e e2 where e2.earned > e.earned)::int + 1 as rank
         from e where e.user_id = $1::uuid`,
        [session.userId],
      ),
    ]);
  } catch (error) {
    console.error("[explore] leaderboard failed", (error as Error).message);
    return res.status(500).json({ ok: false });
  }
  const players = top.map((u, i) => ({
    rank: i + 1,
    id: String(u.id),
    display_name: u.display_name,
    skin: u.skin,
    pixels: Math.round(Number(u.earned) || 0),
    you: String(u.id) === session.userId,
  }));
  const me = mine[0];
  const yourPixels = me ? Math.round(Number(me.earned) || 0) : 0;
  const yourRank = me ? Number(me.rank) || 0 : 0;

  // During a leaderboard sprint, a second board counts only pixels earned
  // inside the event window (approvals and bounties - nothing manual).
  let sprint: Record<string, unknown> | null = null;
  const [sprintEvent] = await activeEvents(["leaderboard_sprint"]);
  if (sprintEvent) {
    const { data: txs } = await db
      .from("pixel_transactions")
      .select("user_id, amount")
      .gt("amount", 0)
      .in("reason", ["project_approved", "bounty"])
      .gte("created_at", sprintEvent.starts_at)
      .lt("created_at", sprintEvent.ends_at);
    const earned = new Map<string, number>();
    for (const t of txs ?? [])
      earned.set(t.user_id as string, (earned.get(t.user_id as string) ?? 0) + Number(t.amount));
    const ranked = [...earned.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    const names = new Map<string, string>();
    if (ranked.length > 0) {
      const { data: users } = await db
        .from("users")
        .select("id, display_name")
        .in("id", ranked.map(([id]) => id));
      for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
    }
    sprint = {
      name: sprintEvent.name || "Leaderboard sprint",
      ends_at: sprintEvent.ends_at,
      players: ranked.map(([id, px], i) => ({
        rank: i + 1,
        display_name: names.get(id) ?? "?",
        pixels: Math.round(px),
        you: id === session.userId,
      })),
      your_pixels: Math.round(earned.get(session.userId) ?? 0),
    };
  }

  res.json({ ok: true, players, yourRank, yourPixels, sprint });
});

// Top referrers by how many people they've referred (see [[referral-system]]
// in project memory) , every row in `referrals` counts here, rewarded or
// still pending, since "who referred the most" is a headcount, not a payout.
// Pixels earned (the rewarded-only metric) rides along as secondary context.
// Mirrors apps/dashboard/lib/db.ts's referrerLeaderboard pixel metric ,
// duplicated here rather than imported since that's a "use server" module
// the game server can't pull in.
const REFERRAL_MILESTONE_EVERY = 10;
const REFERRAL_MILESTONE_PX = 119;
router.get("/api/explore/leaderboard/referrals", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const select = `select referrer_id::text as id, count(*)::int as total, count(rewarded_at)::int as rewarded,
       coalesce(sum(reward_pixels) filter (where rewarded_at is not null), 0)::bigint as pixels
     from referrals`;
  let top: Record<string, unknown>[];
  let mine: Record<string, unknown>[];
  try {
    [top, mine] = await Promise.all([
      leaderboardDeps.query(`${select} group by referrer_id order by total desc, referrer_id limit $1`, [LEADERBOARD_SIZE]),
      leaderboardDeps.query(`${select} where referrer_id = $1::uuid group by referrer_id`, [session.userId]),
    ]);
  } catch (error) {
    console.error("[explore] referral leaderboard failed", (error as Error).message);
    return res.status(500).json({ ok: false });
  }
  const byReferrer = new Map<string, { total: number; rewarded: number; pixels: number }>();
  for (const r of [...top, ...mine]) {
    const rewarded = Number(r.rewarded) || 0;
    byReferrer.set(String(r.id), {
      total: Number(r.total) || 0,
      rewarded,
      pixels: (Number(r.pixels) || 0) + Math.floor(rewarded / REFERRAL_MILESTONE_EVERY) * REFERRAL_MILESTONE_PX,
    });
  }

  const ranked = top.map((r) => [String(r.id), byReferrer.get(String(r.id))!] as const);
  const ids = ranked.map(([id]) => id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: users } = await db.from("users").select("id, display_name").in("id", ids);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }
  const players = ranked.map(([id, row], i) => ({
    rank: i + 1,
    display_name: names.get(id) ?? "?",
    value: row.total,
    rewarded: row.rewarded,
    pixels: row.pixels,
    you: id === session.userId,
  }));
  const yourRank = players.find((p) => p.you)?.rank ?? 0;
  res.json({ ok: true, players, yourRank, yourValue: byReferrer.get(session.userId)?.total ?? 0 });
});

// Top creators by total upvotes received across all their projects (see
// [[project-upvotes-collectibles]] in project memory).
router.get("/api/explore/leaderboard/upvotes", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const select = `select p.user_id::text as id, count(*)::int as n
     from project_upvotes u join projects p on p.id = u.project_id`;
  let top: Record<string, unknown>[];
  let mine: Record<string, unknown>[];
  try {
    [top, mine] = await Promise.all([
      leaderboardDeps.query(`${select} group by p.user_id order by n desc, p.user_id limit $1`, [LEADERBOARD_SIZE]),
      leaderboardDeps.query(`${select} where p.user_id = $1::uuid group by p.user_id`, [session.userId]),
    ]);
  } catch (error) {
    console.error("[explore] upvote leaderboard failed", (error as Error).message);
    return res.status(500).json({ ok: false });
  }
  const byOwner = new Map<string, number>();
  for (const r of [...top, ...mine]) byOwner.set(String(r.id), Number(r.n) || 0);
  const ranked = top.map((r) => [String(r.id), Number(r.n) || 0] as const);
  const ids = ranked.map(([id]) => id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: users } = await db.from("users").select("id, display_name").in("id", ids);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }
  const players = ranked.map(([id, count], i) => ({
    rank: i + 1,
    display_name: names.get(id) ?? "?",
    value: count,
    you: id === session.userId,
  }));
  const yourRank = players.find((p) => p.you)?.rank ?? 0;
  res.json({ ok: true, players, yourRank, yourValue: byOwner.get(session.userId) ?? 0 });
});

// Upvote count per project + whether this viewer already upvoted each one.
async function upvoteInfo(pids: number[], viewerId: string | undefined) {
  const upCounts = new Map<number, number>();
  const myUp = new Set<number>();
  if (pids.length > 0) {
    const { data: ups } = await db
      .from("project_upvotes")
      .select("project_id, voter_id")
      .in("project_id", pids);
    for (const u of ups ?? []) {
      const pid = u.project_id as number;
      upCounts.set(pid, (upCounts.get(pid) ?? 0) + 1);
      if (viewerId && u.voter_id === viewerId) myUp.add(pid);
    }
  }
  return { upCounts, myUp };
}

router.get("/api/explore/showcase", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data: projects, error } = await db
    .from("projects")
    .select(PUBLIC_PROJECT_COLUMNS)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(4);
  if (error) {
    console.error("[explore] showcase failed", error);
    return res.status(500).json({ ok: false });
  }

  const ids = [...new Set((projects ?? []).map((p) => p.user_id as string))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, display_name")
      .in("id", ids);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }
  const { upCounts, myUp } = await upvoteInfo(
    (projects ?? []).map((p) => p.id as number),
    session.userId,
  );

  res.json({
    ok: true,
    projects: (projects ?? []).map((p) => ({
      ...p,
      owner_name: names.get(p.user_id as string) ?? "?",
      upvotes: upCounts.get(p.id as number) ?? 0,
      has_upvoted: myUp.has(p.id as number),
    })),
  });
});

router.get("/api/explore/players/:id", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const id = String(req.params.id);
  const userQuery = (fields: string) =>
    db.from("users").select(fields).eq("id", id).maybeSingle();
  const [user, fallbackUser, projects, owned] = await Promise.all([
    userQuery("id, display_name, skin, created_at, pixels, avatar_url, card_pixelate"),
    userQuery("id, display_name, skin, created_at, pixels, avatar_url"),
    db
      .from("projects")
      .select(PUBLIC_PROJECT_COLUMNS)
      .eq("user_id", id)
      .is("archived_at", null)
      .is("rejected_at", null)
    .is("banned_at", null)
      .order("created_at", { ascending: false }),
    db
      .from("collectible_purchases")
      .select("created_at, collectibles(id, name, description, image_url)")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const data = (user.error ? fallbackUser.data : user.data) as Record<string, unknown> | null;
  if (!data) return res.status(404).json({ ok: false });

  const collectibles = (owned.data ?? [])
    .map((r) => {
      const row = r as { collectibles: unknown; created_at: string };
      if (!row.collectibles) return null;
      return { ...(row.collectibles as Record<string, unknown>), unlocked_at: row.created_at };
    })
    .filter(Boolean);

  const [xp, re] = await Promise.all([approvedHoursFor(id), lifetimeRe(id)]);
  res.json({
    ok: true,
    player: { ...data, xp_hours: xp, re, level: levelForRe(re) },
    projects: projects.data ?? [],
    collectibles,
  });
});

// #public, no session needed - what a shared /players/<id> link shows, and
// what its preview card is drawn from.
//
// Deliberately narrower than the authed route above. That one returns every
// project including drafts, plus the collectibles shelf; this returns only
// approved ships, so a link you can paste anywhere can't leak what somebody
// is still working on. Fields match the already-public directory
// (/api/explore/players) plus the builder stats the profile shows: level, RE,
// approved hours, pixels. Pixel balances are already public through the
// leaderboard, so this adds no new exposure there.
//
// No referral-window holdout here, unlike the directory. That holdout exists
// to stop the directory being a newest-signups list to DM referral codes at;
// looking somebody up by their UUID isn't an enumeration vector, and holding
// new accounts out would break the profile link of the players most likely to
// be sharing one.
router.get("/api/explore/players/:id/public", async (req, res) => {
  const id = String(req.params.id);
  // Postgres errors on a malformed uuid rather than returning no rows.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return res.status(404).json({ ok: false });

  const userQuery = (fields: string) =>
    db.from("users").select(fields).eq("id", id).maybeSingle();
  // card_pixelate arrives with migration 0030, same graceful fallback the
  // directory route uses. slack_id/email are never selected.
  const [user, fallbackUser, projects] = await Promise.all([
    userQuery("id, display_name, skin, created_at, pixels, avatar_url, card_pixelate"),
    userQuery("id, display_name, skin, created_at, pixels, avatar_url"),
    db
      .from("projects")
      .select(PUBLIC_PROJECT_COLUMNS)
      .eq("user_id", id)
      .eq("status", "approved")
      .is("archived_at", null)
      .is("rejected_at", null)
      .is("banned_at", null)
      .order("shipped_at", { ascending: false }),
  ]);
  const data = (user.error ? fallbackUser.data : user.data) as Record<string, unknown> | null;
  if (!data) return res.status(404).json({ ok: false });

  const [xp, re] = await Promise.all([approvedHoursFor(id), lifetimeRe(id)]);
  res.json({
    ok: true,
    player: { ...data, xp_hours: xp, re, level: levelForRe(re) },
    projects: projects.data ?? [],
  });
});

// Browse everyone's projects (including drafts), newest first, with optional
// search/tier/shipped filters.
// #public, token optional (just for has_upvoted)
router.get("/api/explore/projects", async (req, res) => {
  const session = req.session;

  const q = searchText(req.query.q);
  const tier = typeof req.query.tier === "string" ? Number(req.query.tier) : NaN;
  const shipped = typeof req.query.shipped === "string" ? req.query.shipped : "";
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 100;
  let query = db
    .from("projects")
    .select(PUBLIC_PROJECT_COLUMNS)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    // Beacon-nominated projects (is_peak) surface first, then newest-first
    // within each group - a reviewer nomination is meant to get a project
    // more eyes on Explore, not just a badge nobody sees.
    .order("is_peak", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (q) query = query.ilike("name", `%${q}%`);
  if (Number.isInteger(tier) && tier >= 1 && tier <= 4) query = query.eq("level", tier);
  if (shipped === "shipped") query = query.eq("status", "approved");
  else if (shipped === "unshipped") query = query.neq("status", "approved");
  const { data: projects, error } = await query;
  if (error) {
    console.error("[explore] projects failed", error);
    return res.status(500).json({ ok: false });
  }

  const ids = [...new Set((projects ?? []).map((p) => p.user_id as string))];
  const owners = new Map<string, { id: string; display_name: string; avatar_url: string | null }>();
  if (ids.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, display_name, avatar_url")
      .in("id", ids);
    for (const u of users ?? [])
      owners.set(u.id as string, {
        id: u.id as string,
        display_name: u.display_name as string,
        avatar_url: (u.avatar_url as string) || null,
      });
  }

  const { upCounts, myUp } = await upvoteInfo(
    (projects ?? []).map((p) => p.id as number),
    session?.userId,
  );

  res.json({
    ok: true,
    projects: (projects ?? []).map((p) => ({
      ...p,
      owner_name: owners.get(p.user_id as string)?.display_name ?? "?",
      owner: owners.get(p.user_id as string) ?? null,
      upvotes: upCounts.get(p.id as number) ?? 0,
      has_upvoted: myUp.has(p.id as number),
    })),
  });
});

// #public, token optional (just for has_upvoted)
router.get("/api/explore/projects/:id", async (req, res) => {
  const session = req.session;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project, error } = await db
    .from("projects")
    .select(PUBLIC_PROJECT_COLUMNS)
    .eq("id", id)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    .maybeSingle();
  if (error || !project) return res.status(404).json({ ok: false });

  const [owner, entries, ups, reviews, payout, earnedTxs] = await Promise.all([
    db
      .from("users")
      .select("id, display_name, avatar_url")
      .eq("id", project.user_id as string)
      .maybeSingle(),
    // #safe-fields-only
    db
      .from("project_journals")
      .select("id, title, content, hours, created_at, edited_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("project_upvotes")
      .select("voter_id")
      .eq("project_id", id),
    // Final player-facing verdicts only, with the same note and hours the
    // owner sees on their own timeline. The reviewer identity and every
    // intermediate verdict (first-pass proposals, ban proposals, fraud
    // review) stay internal to the dashboard.
    db
      .from("review_audits")
      .select("verdict, note, claimed_hours, approved_hours, created_at")
      .eq("project_id", id)
      .in("verdict", ["approved", "needs_changes"])
      .order("created_at", { ascending: true }),
    db
      .from("projects")
      .select("approved_hours")
      .eq("id", id)
      .maybeSingle(),
    // Same sum the owner's own project list shows as "PX EARNED".
    db
      .from("pixel_transactions")
      .select("amount")
      .eq("project_id", id)
      .in("reason", ["project_approved", "review_reverted"]),
  ]);

  const upvoters = ups.data ?? [];
  // Credited hours are only real once the project is approved (see
  // toPlayerProject in projects.ts), so a stale value from an earlier review
  // cycle never shows, and a needs_changes verdict's hours stay hidden too.
  const approved = project.status === "approved";
  res.json({
    ok: true,
    project: {
      ...project,
      approved_hours: approved ? (payout.data?.approved_hours ?? null) : null,
      pixels_earned: (earnedTxs.data ?? []).reduce((s, t) => s + Number(t.amount), 0),
    },
    owner: owner.data ?? null,
    entries: entries.data ?? [],
    reviews: (reviews.data ?? []).map((r) => ({
      verdict: r.verdict,
      created_at: r.created_at,
      note: r.note ?? "",
      claimed_hours: r.claimed_hours ?? null,
      approved_hours: r.verdict === "approved" ? (r.approved_hours ?? null) : null,
    })),
    upvotes: upvoters.length,
    has_upvoted: !!session && upvoters.some((u) => u.voter_id === session.userId),
  });
});

export default router;
