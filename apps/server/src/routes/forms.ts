import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../db/client.js";
import { rateLimit } from "../rateLimit.js";

// Public, no-account forms (e.g. pixl.hackclub.com/form/review). A submitter
// never gets a Pixl player account.
//
// This originally verified the submitter's real Slack identity via Hack Club
// Auth (OAuth), so nobody could type someone else's Slack id and get them
// DMed a fake application receipt/decision. That needed a new redirect URI
// registered on the HCA app, which wasn't available - dropped in favor of a
// plain slackId field instead. The one check that's still possible without
// OAuth: confirming the id resolves to a real member of this Slack
// workspace (via users.info), which catches typos/garbage but does NOT
// prove the submitter actually IS that person - spoofing someone else's id
// is possible again with this approach.

const router = Router();

const MAX_ANSWER_LEN = 4000;
const MAX_ANSWERS = 30;
const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/;

async function lookupSlackUser(slackId: string): Promise<{ name: string } | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const json = (await r.json()) as {
      ok?: boolean;
      user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } };
    };
    if (!json.ok || !json.user) return null;
    const name =
      json.user.profile?.display_name || json.user.profile?.real_name || json.user.real_name || slackId;
    return { name };
  } catch {
    return null;
  }
}

// Defense in depth: reject anything whose Origin/Referer isn't this apex.
// Doesn't stop a non-browser client from forging both headers, but this
// endpoint is public by design (no account, no secret to check) - it's meant
// to keep a browser-based attack (e.g. a form on another site auto-POSTing
// here) from working, not to be the only line of defense.
const APEX_URL = "https://pixl.hackclub.com";
function isTrustedOrigin(req: import("express").Request): boolean {
  const origin = req.headers.origin || req.headers.referer || "";
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(APEX_URL).host;
  } catch {
    return false;
  }
}

// Tighter than the app-wide write limiter (60/min) - this is a public,
// unauthenticated endpoint, worth its own low ceiling.
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: "form_submit" });

router.post("/api/forms/:formKey/submit", submitLimiter, async (req, res) => {
  const formKey = req.params.formKey;
  if (!isTrustedOrigin(req)) return res.status(403).json({ ok: false, error: "bad_origin" });

  const body = req.body as { answers?: unknown; website?: unknown; slackId?: unknown };
  // Honeypot: a real user never fills this (CSS-hidden field). A bot filling
  // every input on the page will. Pretend success so a bot doesn't learn to
  // avoid it, but never actually store or notify on it.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.json({ ok: true });
  }

  const slackId = String(body.slackId ?? "").trim();
  if (!SLACK_ID_RE.test(slackId))
    return res.status(400).json({ ok: false, error: "invalid_slack_id" });
  const slackUser = await lookupSlackUser(slackId);
  if (!slackUser) return res.status(400).json({ ok: false, error: "slack_id_not_found" });

  const rawAnswers = body.answers;
  if (typeof rawAnswers !== "object" || rawAnswers === null || Array.isArray(rawAnswers))
    return res.status(400).json({ ok: false, error: "invalid_answers" });
  const entries = Object.entries(rawAnswers as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_ANSWERS)
    return res.status(400).json({ ok: false, error: "invalid_answers" });
  const answers: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof key !== "string" || key.length > 100) continue;
    answers[key] = String(value ?? "").slice(0, MAX_ANSWER_LEN);
  }

  // One pending submission per person per form at a time - resubmitting
  // while still pending would just spam the reviewer queue and the "received"
  // DM; once a decision is made they're free to submit again.
  const { data: existing } = await supabase
    .from("form_submissions")
    .select("id")
    .eq("form_key", formKey)
    .eq("slack_id", slackId)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return res.status(409).json({ ok: false, error: "already_pending" });

  const ip = req.ip ?? "";
  const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";

  const { data: inserted, error } = await supabase
    .from("form_submissions")
    .insert({
      form_key: formKey,
      slack_id: slackId,
      name: slackUser.name,
      answers,
      ip_hash: ipHash,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("[forms] insert failed", error?.message);
    return res.status(500).json({ ok: false, error: "insert_failed" });
  }

  await dmSlackUser(
    slackId,
    `Thanks for applying! Your submission for "${formKey}" was received , we'll DM you once it's been looked at.`,
  );

  res.json({ ok: true });
});

async function dmSlackUser(slackId: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: slackId, text }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!json?.ok) console.error("[forms] DM failed", json?.error ?? "no response body");
  } catch (e) {
    console.error("[forms] DM failed", e);
  }
}

export default router;
