import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { audit } from "../audit.js";
import { validate, v } from "../http/validate.js";
import { NPS_AREAS, canUseNps, npsMode, npsWave, parseSlackIds } from "../npsAccess.js";

const router = Router();

// The NPS survey is gated by NPS_MODE (off | preview | live) and, in preview,
// by NPS_PREVIEW_SLACK_IDS. Both are read per request. A player who is not
// allowed in gets the same answer as if the survey did not exist.
function allowed(slackId: string | undefined): boolean {
  return canUseNps(npsMode(process.env.NPS_MODE), parseSlackIds(process.env.NPS_PREVIEW_SLACK_IDS), slackId);
}

const ratingShape = Object.fromEntries(
  NPS_AREAS.map((area) => [area, z.number().int().min(1).max(5).optional()]),
) as Record<(typeof NPS_AREAS)[number], z.ZodOptional<z.ZodNumber>>;

const answerBody = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string().max(1000).optional(),
  ratings: z.object(ratingShape).optional(),
  fixText: z.string().max(500).optional(),
  contactOk: z.boolean().optional(),
});

function clean(text: string | undefined, max: number): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Whether this player can see the survey, and whether they already answered
// the current wave.
router.get("/api/nps/status", validate({ query: v.noQuery }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });
  if (!allowed(session.slackId)) return res.json({ ok: true, available: false });

  const wave = npsWave();
  const { data } = await db
    .from("nps_responses")
    .select("id")
    .eq("user_id", session.userId)
    .eq("wave", wave)
    .limit(1);
  res.json({ ok: true, available: true, wave, answered: (data ?? []).length > 0 });
});

// Record an answer for the current wave. One answer per player per wave.
router.post("/api/nps", validate({ query: v.noQuery, body: answerBody }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });
  const base = { actorType: "player" as const, actorId: session.userId, slackId: session.slackId ?? null, action: "nps.answer" };
  if (!allowed(session.slackId)) {
    audit({ ...base, result: "denied", meta: { reason: "not_available" } });
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const wave = npsWave();
  const body = req.body as z.infer<typeof answerBody>;
  const ratings: Record<string, number> = {};
  for (const area of NPS_AREAS) {
    const value = body.ratings?.[area];
    if (typeof value === "number") ratings[area] = value;
  }

  const { data: existing } = await db
    .from("nps_responses")
    .select("id")
    .eq("user_id", session.userId)
    .eq("wave", wave)
    .limit(1);
  if ((existing ?? []).length > 0) return res.status(409).json({ ok: false, error: "already_answered" });

  const { error } = await db.from("nps_responses").insert({
    user_id: session.userId,
    wave,
    score: body.score,
    reason: clean(body.reason, 1000),
    ratings,
    fix_text: clean(body.fixText, 500),
    contact_ok: body.contactOk === true,
  });
  if (error) {
    // A second tab can race the check above; the unique key settles it.
    if (/duplicate|unique/i.test(error.message)) return res.status(409).json({ ok: false, error: "already_answered" });
    console.error("nps insert failed", error.message);
    audit({ ...base, target: wave, result: "error" });
    return res.status(500).json({ ok: false });
  }

  // The text answers can hold personal details, so only the score and the wave
  // go to the audit log.
  audit({ ...base, target: wave, result: "ok", meta: { score: body.score } });
  res.json({ ok: true });
});

export default router;
