import { Router } from "express";
import { z } from "zod";
import { listOnlinePlayers, kickPlayer, endUserSession } from "../ws/gameServer.js";
import { forgetCachedRevocation, revokeUserSessions } from "../auth/revocation.js";
import { refreshEntryEvidence } from "../operations/service.js";
import { validate, v } from "../http/validate.js";
import { loadQueueStats } from "../queueStats.js";

const router = Router();

// Service-to-server admin API. Every /api/admin/* route is behind
// adminServiceGate (http/serviceKeys.ts, mounted in index.ts): only a valid
// x-pixl-service-key reaches these handlers, and req.service names the
// caller. Each call is audited by auditApiRequests.

router.get("/api/admin/online", (_req, res) => {
  res.json({ ok: true, players: listOnlinePlayers() });
});

// Aggregate review-queue stats for the public /queue page. The page renders
// them server-side with the player dashboard's service key; they are never
// exposed as a public API route.
router.get("/api/admin/queue", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await loadQueueStats()) });
  } catch (error) {
    console.error("[admin] queue stats failed", error);
    res.status(500).json({ ok: false });
  }
});

router.post(
  "/api/admin/kick",
  validate({
    query: v.noQuery,
    body: z.object({ userId: v.uuid, reason: z.string().max(500).optional() }),
  }),
  (req, res) => {
    const userId = String(req.body.userId);
    const reason = String(req.body.reason ?? "").slice(0, 100);
    const kicked = kickPlayer(userId, reason ? `Kicked by a moderator: ${reason}` : "");
    res.json({ ok: true, kicked });
  },
);

router.post(
  "/api/admin/revoke-sessions",
  validate({ query: v.noQuery, body: z.object({ userId: v.uuid }) }),
  async (req, res) => {
    const userId = String(req.body.userId).trim().toLowerCase();
    const revokedAtMs = Date.now();
    // Moderation revokes both clients, the game and the Pixl Dashboard.
    const result = await revokeUserSessions(userId, revokedAtMs, "all");
    if (result === "not_found") return res.status(404).json({ ok: false, error: "no such user" });
    if (result === "not_migrated") return res.status(503).json({ ok: false, error: "session revocation migration not applied" });
    if (result === "error") return res.status(500).json({ ok: false, error: "revocation failed" });
    forgetCachedRevocation(userId);
    console.log("[admin] revoked all sessions for", userId);
    res.json({ ok: true, kicked: endUserSession(userId, revokedAtMs) });
  },
);

// Called from the dashboard's Blackout review-decision action, before it
// applies the reviewer's eligible/ineligible call - see
// operations/service.ts's refreshEntryEvidence for why this can't just be
// "reship again" (it isn't a player action, and requiring one is exactly
// the bug this closes).
router.post(
  "/api/admin/operations/refresh-evidence",
  validate({ query: v.noQuery, body: z.object({ entryId: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const result = await refreshEntryEvidence(Number(req.body.entryId));
    res.json(result);
  },
);

export default router;
