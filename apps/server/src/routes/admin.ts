import { Router, type Request } from "express";
import { timingSafeEqual } from "crypto";
import { listOnlinePlayers, kickPlayer, endUserSession } from "../ws/gameServer.js";
import { forgetCachedRevocation, revokeUserSessions } from "../auth/revocation.js";
import { refreshEntryEvidence } from "../operations/service.js";

const router = Router();

// Dashboard-to-server admin API, guarded by a shared secret. Exported so
// other route files needing the same dashboard-only gate (e.g. uploads.ts's
// /api/admin/uploads) can reuse it instead of re-implementing the check.
export function authorized(req: Request): boolean {
  const key = process.env.ADMIN_API_KEY;
  const given = req.header("x-admin-key") ?? "";
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

router.get("/api/admin/online", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true, players: listOnlinePlayers() });
});

router.post("/api/admin/kick", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false });
  const userId = String(req.body?.userId ?? "");
  const reason = String(req.body?.reason ?? "").slice(0, 100);
  if (!userId) return res.status(400).json({ ok: false, error: "userId required" });
  const kicked = kickPlayer(
    userId,
    reason ? `Kicked by a moderator: ${reason}` : "",
  );
  res.json({ ok: true, kicked });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/api/admin/revoke-sessions", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false });
  const userId = String(req.body?.userId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(userId)) return res.status(400).json({ ok: false, error: "userId must be a uuid" });
  const revokedAtMs = Date.now();
  const result = await revokeUserSessions(userId, revokedAtMs);
  if (result === "not_found") return res.status(404).json({ ok: false, error: "no such user" });
  if (result === "not_migrated") return res.status(503).json({ ok: false, error: "session revocation migration not applied" });
  if (result === "error") return res.status(500).json({ ok: false, error: "revocation failed" });
  forgetCachedRevocation(userId);
  console.log("[admin] revoked all sessions for", userId);
  res.json({ ok: true, kicked: endUserSession(userId, revokedAtMs) });
});

// Called from the dashboard's Blackout review-decision action, before it
// applies the reviewer's eligible/ineligible call - see
// operations/service.ts's refreshEntryEvidence for why this can't just be
// "reship again" (it isn't a player action, and requiring one is exactly
// the bug this closes).
router.post("/api/admin/operations/refresh-evidence", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false });
  const entryId = Number(req.body?.entryId);
  if (!Number.isInteger(entryId) || entryId <= 0)
    return res.status(400).json({ ok: false, error: "entryId required" });
  const result = await refreshEntryEvidence(entryId);
  res.json(result);
});

export default router;
