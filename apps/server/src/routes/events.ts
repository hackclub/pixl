import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { activeEvents, communityGoalProgress } from "../events.js";
import { totalCommunityRe } from "../xp.js";

const router = Router();

// Live events for the in-game banner. Community goals carry their progress so
// the game can show "18/25 ships". community_re is unrelated to any single
// event - it's the "Core Integrity" total shown in the web shell's topbar,
// always present regardless of whether a weekend event is running.
router.get("/api/events/active", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const [events, communityRe] = await Promise.all([activeEvents(), totalCommunityRe()]);
  const out = [];
  for (const ev of events) {
    const item: Record<string, unknown> = {
      id: ev.id,
      type: ev.type,
      name: ev.name,
      ends_at: ev.ends_at,
    };
    if (ev.type === "community_goal") {
      item.target = Number(ev.config.target) || 0;
      item.progress = await communityGoalProgress(ev);
      item.bonus_pct = Number(ev.config.bonusPct) || 0;
    }
    if (ev.type === "bounty") item.reward = Number(ev.config.reward) || 0;
    out.push(item);
  }
  res.json({ ok: true, events: out, community_re: communityRe });
});

export default router;
