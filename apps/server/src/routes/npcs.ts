import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";

const router = Router();

// Worlds the client can ask for. Anything else is a typo or a probe, reject it
// rather than running a query that can only return nothing.
const WORLDS = new Set(["village", "open_world"]);

// Every NPC the client should spawn in a world. Replaces the hand-placed nodes
// that used to live in village.tscn / open_world.tscn, so an NPC can be authored
// in the dashboard without shipping a new game build.
//
// `trial_name` is resolved from the joined sidequests row rather than stored on
// the NPC: npc.gd matches its Trial by name, and reading the live name here means
// renaming a Trial in the dashboard can't silently orphan its giver. An inactive
// Trial resolves to "" for the same reason /api/sidequests hides it, the NPC
// then falls through to its flavor-text branch instead of offering a dead quest.
router.get("/api/npcs", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const world = typeof req.query.world === "string" ? req.query.world : "";
  if (!WORLDS.has(world)) {
    return res.status(400).json({ ok: false, error: "unknown_world" });
  }

  const { data, error } = await supabase
    .from("npcs")
    .select(
      "id, world, pos_x, pos_y, npc_name, skin, custom_hair, custom_sheet, dialogue, " +
        "opens_projects, opens_explore, quest_project, faq, quest_trial, trial_checkin, " +
        "sidequest_id, quest_offer, quest_done, trial_reminder, " +
        "wanders, speed, wander_radius, min_wait, max_wait, sort_order, " +
        "sidequests(name, active)",
    )
    .eq("world", world)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[npcs] list failed", error.message);
    // An empty list leaves the world unpopulated, which the client treats as a
    // signal to fall back to its baked copy rather than showing an empty town.
    return res.status(500).json({ ok: false });
  }

  const npcs = (data ?? []).map((n) => {
    const trial = (n as { sidequests?: { name?: string; active?: boolean } | null })
      .sidequests;
    const { sidequests: _joined, ...rest } = n as Record<string, unknown>;
    return {
      ...rest,
      trial_name: trial?.active ? String(trial.name ?? "") : "",
    };
  });

  res.json({ ok: true, npcs });
});

export default router;
