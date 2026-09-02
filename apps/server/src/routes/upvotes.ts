import { Router } from "express";
import type { TransactionSql } from "postgres";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { withLock } from "../db/advisoryLock.js";

const router = Router();

// Upvotes a player's projects have received, summed across every project they
// own. No longer minus anything spent - collectibles are auto-granted (see
// grantEligibleCollectibles below), never bought, so there's nothing to spend.
async function receivedUpvotes(userId: string): Promise<number> {
  const { data: mine } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId);
  const ids = (mine ?? []).map((p) => p.id as number);
  if (ids.length === 0) return 0;
  const { count } = await supabase
    .from("project_upvotes")
    .select("id", { count: "exact", head: true })
    .in("project_id", ids);
  return count ?? 0;
}

// Auto-grant every active collectible whose cost the owner's current received
// total has reached, that they don't already own. Called after an upvote
// lands - never after a removal, since a collectible earned once is kept for
// good (see the removal endpoints below), so there's nothing to re-check on
// the way down. Must run inside the same locked transaction as the vote
// insert so a burst of upvotes across a player's projects can't grant the
// same collectible twice.
async function grantEligibleCollectibles(tx: TransactionSql, ownerId: string): Promise<void> {
  const ownedProjects = await tx`select id from projects where user_id = ${ownerId}`;
  const ids = ownedProjects.map((p) => p.id as number);
  if (ids.length === 0) return;
  const [{ n }] =
    await tx`select count(*)::int as n from project_upvotes where project_id = any(${ids})`;
  const received = n as number;
  const eligible = await tx`
    select id, cost from collectibles
    where active = true and cost <= ${received}
      and id not in (select collectible_id from collectible_purchases where user_id = ${ownerId})
  `;
  for (const c of eligible) {
    await tx`insert into collectible_purchases (user_id, collectible_id, cost) values (${ownerId}, ${c.id}, ${c.cost}) on conflict do nothing`;
  }
}

// Upvote on an approved project. One per voter, can't upvote your own work.
// Idempotent to re-hits; removable via the DELETE route below.
router.post("/api/projects/:id/upvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, status")
    .eq("id", id)
    .is("archived_at", null)
    .is("banned_at", null)
    .maybeSingle();
  if (!project || project.status !== "approved")
    return res.status(404).json({ ok: false, error: "not_found" });
  if (project.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_project" });

  try {
    // A lock scoped to this (project, voter) pair closes the race where a
    // concurrent upvote and downvote for the same project each read "no
    // opposite vote exists" before either writes, leaving the voter holding
    // both directions at once.
    const result = await withLock(
      `project_vote:${id}:${session.userId}`,
      async (tx) => {
        const existingDownvote = (
          await tx`select id from project_downvotes where project_id = ${id} and voter_id = ${session.userId}`
        )[0];
        if (existingDownvote) return { error: "already_downvoted" as const };

        await tx`insert into project_upvotes (project_id, voter_id) values (${id}, ${session.userId}) on conflict do nothing`;
        const [{ n }] =
          await tx`select count(*)::int as n from project_upvotes where project_id = ${id}`;
        await grantEligibleCollectibles(tx, project.user_id as string);
        return { upvotes: n as number };
      },
    );
    if ("error" in result) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, upvotes: result.upvotes, has_upvoted: true });
  } catch (e) {
    console.error("[upvotes] insert failed", e);
    res.status(500).json({ ok: false });
  }
});

// Remove your own upvote. Idempotent (removing a vote that isn't there is a
// no-op). Never claws back a collectible already granted while the vote was
// counted - the owner genuinely reached that threshold at least once, that's
// kept for good (see grantEligibleCollectibles).
router.delete("/api/projects/:id/upvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  try {
    const result = await withLock(`project_vote:${id}:${session.userId}`, async (tx) => {
      await tx`delete from project_upvotes where project_id = ${id} and voter_id = ${session.userId}`;
      const [{ n }] =
        await tx`select count(*)::int as n from project_upvotes where project_id = ${id}`;
      return { upvotes: n as number };
    });
    res.json({ ok: true, upvotes: result.upvotes, has_upvoted: false });
  } catch (e) {
    console.error("[upvotes] delete failed", e);
    res.status(500).json({ ok: false });
  }
});

// Downvote on an approved project. Same rules as upvote: one per voter, can't
// downvote your own project, and a voter can't hold both directions at once
// on the same project. Doesn't touch collectibles - it's a signal, not
// currency. Removable via the DELETE route below.
router.post("/api/projects/:id/downvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, status")
    .eq("id", id)
    .is("archived_at", null)
    .is("banned_at", null)
    .maybeSingle();
  if (!project || project.status !== "approved")
    return res.status(404).json({ ok: false, error: "not_found" });
  if (project.user_id === session.userId)
    return res.status(400).json({ ok: false, error: "own_project" });

  try {
    const result = await withLock(
      `project_vote:${id}:${session.userId}`,
      async (tx) => {
        const existingUpvote = (
          await tx`select id from project_upvotes where project_id = ${id} and voter_id = ${session.userId}`
        )[0];
        if (existingUpvote) return { error: "already_upvoted" as const };

        await tx`insert into project_downvotes (project_id, voter_id) values (${id}, ${session.userId}) on conflict do nothing`;
        const [{ n }] =
          await tx`select count(*)::int as n from project_downvotes where project_id = ${id}`;
        return { downvotes: n as number };
      },
    );
    if ("error" in result) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, downvotes: result.downvotes, has_downvoted: true });
  } catch (e) {
    console.error("[downvotes] insert failed", e);
    res.status(500).json({ ok: false });
  }
});

// Remove your own downvote. Idempotent, same shape as removing an upvote.
router.delete("/api/projects/:id/downvote", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "bad_id" });

  try {
    const result = await withLock(`project_vote:${id}:${session.userId}`, async (tx) => {
      await tx`delete from project_downvotes where project_id = ${id} and voter_id = ${session.userId}`;
      const [{ n }] =
        await tx`select count(*)::int as n from project_downvotes where project_id = ${id}`;
      return { downvotes: n as number };
    });
    res.json({ ok: true, downvotes: result.downvotes, has_downvoted: false });
  } catch (e) {
    console.error("[downvotes] delete failed", e);
    res.status(500).json({ ok: false });
  }
});

// The signed-in player's total received-upvote count. Not currently linked
// from any client (collectibles/index.html reads its number from
// GET /api/collectibles instead) - kept for anything external.
router.get("/api/upvotes/balance", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });
  res.json({ ok: true, balance: await receivedUpvotes(session.userId) });
});

// Collectibles catalog + what the player already owns (auto-granted, never
// bought - see grantEligibleCollectibles) + their live received-upvote count,
// so the client can show progress toward the ones they don't have yet.
router.get("/api/collectibles", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [{ data: items }, { data: owned }, balance] = await Promise.all([
    supabase
      .from("collectibles")
      .select("id, name, description, image_url, cost")
      .eq("active", true)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("collectible_purchases")
      .select("collectible_id")
      .eq("user_id", session.userId),
    receivedUpvotes(session.userId),
  ]);
  const ownedSet = new Set((owned ?? []).map((r) => r.collectible_id as number));
  res.json({
    ok: true,
    balance,
    collectibles: (items ?? []).map((c) => ({ ...c, owned: ownedSet.has(c.id as number) })),
  });
});

export default router;
