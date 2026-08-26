import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { activeEvents } from "../events.js";
import { approvedHoursFor, lifetimeRe, levelForRe } from "../xp.js";
import { REFERRAL_WINDOW_HOURS } from "./referral.js";

const router = Router();

// #public-safe-only, no ban_reason/review_note/system_note/airtable_record_id etc
const PUBLIC_PROJECT_COLUMNS =
  "id, user_id, name, description, project_type, level, status, image_url, repo_url, demo_url, shipped_at, created_at, hackatime_seconds, is_peak";

// #public, no session needed - fields already safe (no slack_id/email)
router.get("/api/explore/players", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  // Accounts still inside their referral window are held out of the
  // directory , sorting newest-first otherwise turns this into a lookup
  // table for finding fresh signups to DM a referral code at (see
  // apps/server/src/routes/referral.ts). They show up here as soon as that
  // window closes and there's nothing left to gain by targeting them.
  const referralSafeCutoff = new Date(Date.now() - REFERRAL_WINDOW_HOURS * 3600_000).toISOString();
  const buildQuery = (fields: string) => {
    let query = supabase
      .from("users")
      .select(fields)
      .lte("created_at", referralSafeCutoff)
      .order("created_at", { ascending: false })
      .limit(100);
    if (q) query = query.ilike("display_name", `%${q}%`);
    return query;
  };
  // card_pixelate arrives with migration 0030 — fall back gracefully before it.
  // slack_id is deliberately not selected — /api/pixify takes our internal
  // user id now, so player Slack member IDs never need to reach the client.
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
    const { data: projects } = await supabase
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

// Top pixel balances for the in-game leaderboard. Read-only; balances are
// server-authoritative so this can't be gamed from the client.
router.get("/api/explore/leaderboard", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, skin, pixels")
    .gt("pixels", 0)
    .order("pixels", { ascending: false })
    .limit(25);
  if (error) {
    console.error("[explore] leaderboard failed", error);
    return res.status(500).json({ ok: false });
  }
  const players = (data ?? []).map((u, i) => ({
    rank: i + 1,
    id: u.id,
    display_name: u.display_name,
    skin: u.skin,
    pixels: Math.round(Number(u.pixels) || 0),
    you: u.id === session.userId,
  }));

  let yourRank = players.find((p) => p.you)?.rank ?? 0;
  let yourPixels = players.find((p) => p.you)?.pixels ?? -1;
  if (yourPixels < 0) {
    const { data: me } = await supabase
      .from("users")
      .select("pixels")
      .eq("id", session.userId)
      .single();
    yourPixels = Math.round(Number(me?.pixels) || 0);
    if (yourPixels > 0) {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .gt("pixels", yourPixels);
      yourRank = (count ?? 0) + 1;
    }
  }

  // During a leaderboard sprint, a second board counts only pixels earned
  // inside the event window (approvals and bounties — nothing manual).
  let sprint: Record<string, unknown> | null = null;
  const [sprintEvent] = await activeEvents(["leaderboard_sprint"]);
  if (sprintEvent) {
    const { data: txs } = await supabase
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
      const { data: users } = await supabase
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
// in project memory) — every row in `referrals` counts here, rewarded or
// still pending, since "who referred the most" is a headcount, not a payout.
// Pixels earned (the rewarded-only metric) rides along as secondary context.
// Mirrors apps/dashboard/lib/db.ts's referrerLeaderboard pixel metric —
// duplicated here rather than imported since that's a "use server" module
// the game server can't pull in.
const REFERRAL_MILESTONE_EVERY = 10;
const REFERRAL_MILESTONE_PX = 119;
router.get("/api/explore/leaderboard/referrals", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("referrals")
    .select("referrer_id, rewarded_at, reward_pixels");
  if (error) {
    console.error("[explore] referral leaderboard failed", error);
    return res.status(500).json({ ok: false });
  }
  const byReferrer = new Map<string, { total: number; rewarded: number; pixels: number }>();
  for (const r of data ?? []) {
    const row = byReferrer.get(r.referrer_id as string) ?? { total: 0, rewarded: 0, pixels: 0 };
    row.total++;
    if (r.rewarded_at) {
      row.rewarded++;
      row.pixels += Number(r.reward_pixels) || 0;
    }
    byReferrer.set(r.referrer_id as string, row);
  }
  for (const row of byReferrer.values())
    row.pixels += Math.floor(row.rewarded / REFERRAL_MILESTONE_EVERY) * REFERRAL_MILESTONE_PX;

  const ranked = [...byReferrer.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25);
  const ids = ranked.map(([id]) => id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: users } = await supabase.from("users").select("id, display_name").in("id", ids);
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
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [{ data: projects, error: pErr }, { data: upvotes, error: uErr }] = await Promise.all([
    supabase.from("projects").select("id, user_id"),
    supabase.from("project_upvotes").select("project_id"),
  ]);
  if (pErr || uErr) {
    console.error("[explore] upvote leaderboard failed", pErr || uErr);
    return res.status(500).json({ ok: false });
  }
  const ownerOf = new Map((projects ?? []).map((p) => [p.id as number, p.user_id as string]));
  const byOwner = new Map<string, number>();
  for (const u of upvotes ?? []) {
    const owner = ownerOf.get(u.project_id as number);
    if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
  }
  const ranked = [...byOwner.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const ids = ranked.map(([id]) => id);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: users } = await supabase.from("users").select("id, display_name").in("id", ids);
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

// Proxy to Pixo's avatar pixelator so the API key never reaches the client.
// Returns the player's Slack avatar as an already-pixelated PNG.
// No fallback domain here on purpose — see the same call in moderation.ts;
// player Slack IDs and avatar traffic must never silently route to whatever
// domain happens to be baked in as a default.
const EXTERNAL_PIXIFY_URL = process.env.EXTERNAL_PIXIFY_URL;

router.get("/api/pixify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  // Takes our own internal user id, not a raw Slack member ID — the client
  // never needs to see anyone's slack_id, this route resolves it itself.
  const userId = typeof req.query.user === "string" ? req.query.user : "";
  const size = Math.min(Math.max(Number(req.query.size) || 32, 2), 64);
  const key = process.env.EXTERNAL_API_KEY;
  if (!userId) return res.status(400).json({ ok: false });
  if (!key || !EXTERNAL_PIXIFY_URL) return res.status(503).json({ ok: false, error: "pixify_not_configured" });

  const { data: target } = await supabase.from("users").select("slack_id").eq("id", userId).maybeSingle();
  const slackId = (target?.slack_id as string) ?? "";
  if (!slackId || !/^[A-Z0-9]{5,20}$/.test(slackId)) return res.status(400).json({ ok: false });

  try {
    const r = await fetch(
      `${EXTERNAL_PIXIFY_URL}?userId=${encodeURIComponent(slackId)}&size=${size}`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ ok: false });
    const buf = Buffer.from(await r.arrayBuffer());
    res
      .set("Content-Type", "image/png")
      .set("Cache-Control", "public, max-age=3600")
      .send(buf);
  } catch {
    res.status(502).json({ ok: false });
  }
});

router.get("/api/explore/showcase", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
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
    const { data: users } = await supabase
      .from("users")
      .select("id, display_name")
      .in("id", ids);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }

  res.json({
    ok: true,
    projects: (projects ?? []).map((p) => ({
      ...p,
      owner_name: names.get(p.user_id as string) ?? "?",
    })),
  });
});

router.get("/api/explore/players/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = String(req.params.id);
  const userQuery = (fields: string) =>
    supabase.from("users").select(fields).eq("id", id).maybeSingle();
  const [user, fallbackUser, projects, owned] = await Promise.all([
    userQuery("id, display_name, skin, created_at, pixels, avatar_url, card_pixelate"),
    userQuery("id, display_name, skin, created_at, pixels, avatar_url"),
    supabase
      .from("projects")
      .select("*")
      .eq("user_id", id)
      .is("archived_at", null)
      .is("rejected_at", null)
    .is("banned_at", null)
      .order("created_at", { ascending: false }),
    supabase
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

// Browse everyone's projects (including drafts), newest first, with optional
// search/tier/shipped filters.
// #public, token optional (just for has_upvoted/has_downvoted)
router.get("/api/explore/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tier = typeof req.query.tier === "string" ? Number(req.query.tier) : NaN;
  const shipped = typeof req.query.shipped === "string" ? req.query.shipped : "";
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 100;
  let query = supabase
    .from("projects")
    .select(PUBLIC_PROJECT_COLUMNS)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    // #no-fraud-review-leak
    .neq("status", "fraud_review")
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
    const { data: users } = await supabase
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

  // Upvote/downvote count per project + whether this viewer already voted each one.
  const pids = (projects ?? []).map((p) => p.id as number);
  const upCounts = new Map<number, number>();
  const myUp = new Set<number>();
  const downCounts = new Map<number, number>();
  const myDown = new Set<number>();
  if (pids.length > 0) {
    const [{ data: ups }, { data: downs }] = await Promise.all([
      supabase.from("project_upvotes").select("project_id, voter_id").in("project_id", pids),
      supabase.from("project_downvotes").select("project_id, voter_id").in("project_id", pids),
    ]);
    for (const u of ups ?? []) {
      const pid = u.project_id as number;
      upCounts.set(pid, (upCounts.get(pid) ?? 0) + 1);
      if (session && u.voter_id === session.userId) myUp.add(pid);
    }
    for (const d of downs ?? []) {
      const pid = d.project_id as number;
      downCounts.set(pid, (downCounts.get(pid) ?? 0) + 1);
      if (session && d.voter_id === session.userId) myDown.add(pid);
    }
  }

  res.json({
    ok: true,
    projects: (projects ?? []).map((p) => ({
      ...p,
      owner_name: owners.get(p.user_id as string)?.display_name ?? "?",
      owner: owners.get(p.user_id as string) ?? null,
      upvotes: upCounts.get(p.id as number) ?? 0,
      has_upvoted: myUp.has(p.id as number),
      downvotes: downCounts.get(p.id as number) ?? 0,
      has_downvoted: myDown.has(p.id as number),
    })),
  });
});

// #public, token optional (just for has_upvoted/has_downvoted)
router.get("/api/explore/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project, error } = await supabase
    .from("projects")
    .select(PUBLIC_PROJECT_COLUMNS)
    .eq("id", id)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    .neq("status", "fraud_review")
    .maybeSingle();
  if (error || !project) return res.status(404).json({ ok: false });

  const [owner, entries, ups, downs, reviews] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name, avatar_url")
      .eq("id", project.user_id as string)
      .maybeSingle(),
    // #safe-fields-only
    supabase
      .from("project_journals")
      .select("id, content, hours, created_at, edited_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_upvotes")
      .select("voter_id")
      .eq("project_id", id),
    supabase
      .from("project_downvotes")
      .select("voter_id")
      .eq("project_id", id),
    // Only verdict + created_at go public here — the reviewer identity and
    // review/audit notes stay internal to the dashboard.
    supabase
      .from("review_audits")
      .select("verdict, created_at")
      .eq("project_id", id)
      .in("verdict", ["approved", "needs_changes"])
      .order("created_at", { ascending: true }),
  ]);

  const upvoters = ups.data ?? [];
  const downvoters = downs.data ?? [];
  res.json({
    ok: true,
    project,
    owner: owner.data ?? null,
    entries: entries.data ?? [],
    reviews: reviews.data ?? [],
    upvotes: upvoters.length,
    has_upvoted: !!session && upvoters.some((u) => u.voter_id === session.userId),
    downvotes: downvoters.length,
    has_downvoted: !!session && downvoters.some((u) => u.voter_id === session.userId),
  });
});

export default router;
