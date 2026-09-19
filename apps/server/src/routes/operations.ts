import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { rateLimit } from "../rateLimit.js";
import {
  getPublicOperation,
  joinOperation,
  listPlayerEntries,
  withdrawFromOperation,
} from "../operations/service.js";

const router = Router();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const writeLimit = rateLimit({ windowMs: 60_000, max: 30, name: "operations-write" });

function sessionOf(req: { query: { token?: unknown } }) {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  return token ? verifySessionToken(token) : null;
}

router.get("/api/operations/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(404).json({ ok: false });

  const op = await getPublicOperation(slug);
  if (!op) return res.status(404).json({ ok: false });

  const session = sessionOf(req);
  const entries = session ? await listPlayerEntries(slug, session.userId) : undefined;
  res.setHeader("Cache-Control", session ? "no-store" : "public, max-age=30");
  res.json({ ok: true, operation: op, ...(entries ? { entries } : {}) });
});

router.post("/api/operations/:slug/entries", writeLimit, async (req, res) => {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ ok: false });
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(404).json({ ok: false });
  const projectId = Number(req.body?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0)
    return res.status(400).json({ ok: false, error: "project_required" });

  const result = await joinOperation(slug, projectId, session.userId);
  if (!result.ok) {
    const status = result.error === "server_error" ? 500 : result.error === "operation_not_found" ? 404 : 400;
    return res.status(status).json({ ok: false, error: result.error, operationStatus: result.operation_status });
  }
  const entries = await listPlayerEntries(slug, session.userId);
  res.json({
    ok: true,
    created: result.created === true,
    entry: entries.find((e) => e.projectId === projectId) ?? null,
  });
});

router.delete("/api/operations/:slug/entries/:projectId", writeLimit, async (req, res) => {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ ok: false });
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(404).json({ ok: false });
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0)
    return res.status(400).json({ ok: false });

  const result = await withdrawFromOperation(slug, projectId, session.userId);
  if (!result.ok) {
    return res.status(result.error === "server_error" ? 500 : 400).json({ ok: false, error: result.error });
  }
  res.json({ ok: true });
});

export default router;
