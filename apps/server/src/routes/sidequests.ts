import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// Quest log: every active sidequest, flagged with whether this player has
// unlocked it (NPCs grant unlocks; that wiring lands later).
router.get("/api/sidequests", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [{ data: quests, error }, { data: unlocks }, { data: projects }, { data: givers }] =
    await Promise.all([
      supabase
        .from("sidequests")
        // min_hours rides along so the projects page can show progress toward
        // the same gate the ship route enforces.
        .select("id, name, region, npc, description, brief, reward, starter, min_hours")
        .eq("active", true)
        .order("position", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("sidequest_unlocks")
        .select("sidequest_id, unlocked_at")
        .eq("user_id", session.userId),
      // A Trial counts as completed once the player has a project linked to it
      // that's reached (or passed) review.
      supabase
        .from("projects")
        .select("sidequest_id")
        .eq("user_id", session.userId)
        .not("sidequest_id", "is", null)
        .in("status", ["shipped", "fraud_review", "second_review", "approved"]),
      // The giver NPC behind each Trial, so the client can spawn a matching
      // check-in copy (same look + the authored reminder line) into the village
      // once the player has accepted it.
      supabase
        .from("npcs")
        .select("sidequest_id, npc_name, skin, trial_reminder, quest_offer")
        .eq("active", true)
        .eq("quest_trial", true)
        .not("sidequest_id", "is", null),
    ]);
  if (error) return res.json({ ok: true, quests: [] });
  const unlockMap = new Map<number, string>();
  for (const u of (unlocks ?? []) as { sidequest_id: number; unlocked_at?: string }[]) {
    unlockMap.set(u.sidequest_id, u.unlocked_at || "");
  }
  const completed = new Set(
    (projects ?? []).map((p) => p.sidequest_id as number),
  );
  // One giver per Trial (the first non-check-in one we see wins).
  const giverBySq = new Map<number, { npc_name: string; skin: string; trial_reminder: string; quest_offer: string }>();
  for (const g of (givers ?? []) as {
    sidequest_id: number;
    npc_name: string;
    skin: string;
    trial_reminder: string;
    quest_offer: string;
  }[]) {
    if (!giverBySq.has(g.sidequest_id)) giverBySq.set(g.sidequest_id, g);
  }
  res.json({
    ok: true,
    quests: (quests ?? []).map((q) => {
      const g = giverBySq.get(q.id as number);
      return {
        ...q,
        unlocked: unlockMap.has(q.id as number),
        unlocked_at: unlockMap.get(q.id as number) || null,
        completed: completed.has(q.id as number),
        // Giver look + reminder for the village check-in copy (falls back to the
        // sidequest's own npc/description client-side if these are blank).
        npc_name: g?.npc_name || (q.npc as string) || "",
        npc_skin: g?.skin || "cvc:1",
        npc_reminder: g?.trial_reminder || g?.quest_offer || "",
      };
    }),
  });
});

// Accept a Trial - the "I'll take it" from an NPC. Idempotent: the unique
// (sidequest_id, user_id) on sidequest_unlocks means re-accepting is a no-op.
// Only active Trials can be accepted.
router.post("/api/sidequests/:id/accept", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: quest } = await supabase
    .from("sidequests")
    .select("id")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (!quest) return res.status(404).json({ ok: false, error: "not_found" });

  const { error } = await supabase
    .from("sidequest_unlocks")
    .upsert(
      { sidequest_id: id, user_id: session.userId },
      { onConflict: "sidequest_id,user_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[sidequests] accept failed", error.message);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

// Pixo's first-Trial recommendation. Picks one active *starter* Trial whose
// difficulty best matches the player's coding experience, but always returns
// the full starter list too, so the Trial Board can offer "browse all" and
// never forces the pick. Requires drizzle/0050 (difficulty/starter columns).
const EXPERIENCE_DIFFICULTY: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

router.get("/api/sidequests/recommended", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [{ data: user }, { data: starters, error }] = await Promise.all([
    supabase
      .from("users")
      .select("coding_experience")
      .eq("id", session.userId)
      .maybeSingle(),
    supabase
      .from("sidequests")
      .select("id, name, region, npc, description, reward, difficulty, tags")
      .eq("active", true)
      .eq("starter", true)
      .order("position", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (error) return res.json({ ok: true, recommended: null, alternatives: [] });

  const list = starters ?? [];
  const want = EXPERIENCE_DIFFICULTY[String(user?.coding_experience ?? "")] ?? 1;
  // Nearest difficulty to `want`; ties already broken by the position/id order
  // above, so a stable reduce keeps the first (lowest-position) match.
  const recommended =
    list.length === 0
      ? null
      : list.reduce((best, q) => {
          const d = (x: { difficulty?: number | null }) =>
            Math.abs((Number(x.difficulty) || 2) - want);
          return d(q) < d(best) ? q : best;
        }, list[0]);

  res.json({ ok: true, recommended, alternatives: list });
});

export default router;
