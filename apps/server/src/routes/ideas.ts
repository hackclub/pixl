import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { withLock } from "../db/advisoryLock.js";
import { containsBlocked } from "../moderation.js";
import { addNotification } from "./notifications.js";

const router = Router();

const IDEA_ROLES = ["art", "code", "audio", "design", "writing"];

// Batch vote counts + this viewer's own votes for a set of ideas — same
// shape as explore.ts's project vote batching.
async function voteInfo(ideaIds: number[], viewerId: string) {
  const upCounts = new Map<number, number>();
  const myUp = new Set<number>();
  const downCounts = new Map<number, number>();
  const myDown = new Set<number>();
  if (ideaIds.length > 0) {
    const [{ data: ups }, { data: downs }] = await Promise.all([
      supabase.from("idea_upvotes").select("idea_id, voter_id").in("idea_id", ideaIds),
      supabase.from("idea_downvotes").select("idea_id, voter_id").in("idea_id", ideaIds),
    ]);
    for (const u of ups ?? []) {
      const id = u.idea_id as number;
      upCounts.set(id, (upCounts.get(id) ?? 0) + 1);
      if (u.voter_id === viewerId) myUp.add(id);
    }
    for (const d of downs ?? []) {
      const id = d.idea_id as number;
      downCounts.set(id, (downCounts.get(id) ?? 0) + 1);
      if (d.voter_id === viewerId) myDown.add(id);
    }
  }
  return { upCounts, myUp, downCounts, myDown };
}

// Browse ideas, newest or top first, with an optional title search.
router.get("/api/ideas", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const sort = req.query.sort === "top" ? "top" : "new";
  let query = supabase
    .from("ideas")
    .select("*")
    .is("banned_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) query = query.ilike("title", `%${q}%`);
  const { data: ideas, error } = await query;
  if (error) {
    console.error("[ideas] list failed", error);
    return res.status(500).json({ ok: false });
  }

  const uids = [...new Set((ideas ?? []).map((i) => i.user_id as string))];
  const names = new Map<string, string>();
  if (uids.length > 0) {
    const { data: users } = await supabase.from("users").select("id, display_name").in("id", uids);
    for (const u of users ?? []) names.set(u.id as string, u.display_name as string);
  }

  const ids = (ideas ?? []).map((i) => i.id as number);
  const { upCounts, myUp, downCounts, myDown } = await voteInfo(ids, session.userId);

  let out = (ideas ?? []).map((i) => ({
    ...i,
    author_name: names.get(i.user_id as string) ?? "?",
    is_mine: i.user_id === session.userId,
    upvotes: upCounts.get(i.id as number) ?? 0,
    has_upvoted: myUp.has(i.id as number),
    downvotes: downCounts.get(i.id as number) ?? 0,
    has_downvoted: myDown.has(i.id as number),
  }));
  if (sort === "top")
    out = out.sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes));

  res.json({ ok: true, ideas: out });
});

// Post an idea. Instant — no review queue, this is just a prompt board.
router.post("/api/ideas", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  const body = String(req.body?.body ?? "").trim().slice(0, 2000);
  if (title.length < 3) return res.status(400).json({ ok: false, error: "title_too_short" });
  if (containsBlocked(title) || containsBlocked(body))
    return res.status(400).json({ ok: false, error: "blocked_content" });

  const isCollab = req.body?.isCollab === true;
  const rolesNeeded = isCollab && Array.isArray(req.body?.rolesNeeded)
    ? [...new Set(req.body.rolesNeeded.filter((r: unknown) => typeof r === "string" && IDEA_ROLES.includes(r)))]
    : [];
  const hoursRaw = Number(req.body?.hoursEstimate);
  const hoursEstimate = isCollab && Number.isFinite(hoursRaw) && hoursRaw > 0
    ? Math.min(hoursRaw, 1000)
    : null;
  const imageUrl = String(req.body?.imageUrl ?? "").trim().slice(0, 500) || null;

  const { data, error } = await supabase
    .from("ideas")
    .insert({
      user_id: session.userId,
      title,
      body,
      is_collab: isCollab,
      roles_needed: rolesNeeded,
      hours_estimate: hoursEstimate,
      image_url: imageUrl,
    })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[ideas] insert failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, idea: data });
});

// Delete one of the user's own ideas.
router.delete("/api/ideas/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { error } = await supabase
    .from("ideas")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[ideas] delete failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

// Permanent upvote on an idea. One per voter, never taken back, can't vote
// your own idea — same rules as project upvotes.
router.post("/api/ideas/:id/upvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, user_id")
    .eq("id", id)
    .is("banned_at", null)
    .maybeSingle();
  if (!idea) return res.status(404).json({ ok: false, error: "not_found" });
  if (idea.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_idea" });

  try {
    const result = await withLock(`idea_vote:${id}:${session.userId}`, async (tx) => {
      const existingDownvote = (
        await tx`select id from idea_downvotes where idea_id = ${id} and voter_id = ${session.userId}`
      )[0];
      if (existingDownvote) return { error: "already_downvoted" as const };

      await tx`insert into idea_upvotes (idea_id, voter_id) values (${id}, ${session.userId}) on conflict do nothing`;
      const [{ n }] =
        await tx`select count(*)::int as n from idea_upvotes where idea_id = ${id}`;
      return { upvotes: n as number };
    });
    if ("error" in result) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, upvotes: result.upvotes, has_upvoted: true });
  } catch (e) {
    console.error("[ideas] upvote insert failed", e);
    res.status(500).json({ ok: false });
  }
});

// Permanent downvote on an idea — same rules as upvote, opposite direction.
router.post("/api/ideas/:id/downvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, user_id")
    .eq("id", id)
    .is("banned_at", null)
    .maybeSingle();
  if (!idea) return res.status(404).json({ ok: false, error: "not_found" });
  if (idea.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_idea" });

  try {
    const result = await withLock(`idea_vote:${id}:${session.userId}`, async (tx) => {
      const existingUpvote = (
        await tx`select id from idea_upvotes where idea_id = ${id} and voter_id = ${session.userId}`
      )[0];
      if (existingUpvote) return { error: "already_upvoted" as const };

      await tx`insert into idea_downvotes (idea_id, voter_id) values (${id}, ${session.userId}) on conflict do nothing`;
      const [{ n }] =
        await tx`select count(*)::int as n from idea_downvotes where idea_id = ${id}`;
      return { downvotes: n as number };
    });
    if ("error" in result) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, downvotes: result.downvotes, has_downvoted: true });
  } catch (e) {
    console.error("[ideas] downvote insert failed", e);
    res.status(500).json({ ok: false });
  }
});

router.post("/api/ideas/:id/apply", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, user_id, title, is_collab")
    .eq("id", id)
    .is("banned_at", null)
    .maybeSingle();
  if (!idea) return res.status(404).json({ ok: false, error: "not_found" });
  if (!idea.is_collab) return res.status(400).json({ ok: false, error: "not_collab" });
  if (idea.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_idea" });

  const authorId = idea.user_id as string;
  void addNotification(
    authorId,
    "Collab application",
    `${session.displayName} wants to collab on "${idea.title}". Link up on Slack for a better convo.`,
  );
  void addNotification(
    session.userId,
    "Collab application sent",
    `You applied to collab on "${idea.title}". Link up on Slack if the poster reaches out.`,
  );
  res.json({ ok: true });
});

export default router;
