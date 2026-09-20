import { Router } from "express";
import crypto from "crypto";
import { supabase } from "../db/client.js";
import { rateLimit } from "../rateLimit.js";
import { config as pixlConfig } from "../config.generated.js";
import { createVerificationStore } from "./formVerification.js";

// Public, no-account forms (e.g. pixl.hackclub.com/form/review). A submitter
// never gets a Pixl player account.
//
// This originally verified the submitter's real Slack identity via Hack Club
// Auth (OAuth), so nobody could type someone else's Slack id and get them
// DMed a fake application receipt/decision. That needed a new redirect URI
// registered on the HCA app, which wasn't available - dropped for a plain
// slackId field with no proof of ownership at all: typing any real member's
// id and submitting worked, since the only check was that the id resolved to
// a real workspace member (a typo check, not an identity check).
//
// Restored as a DM-a-code flow instead of OAuth: request-code sends a short
// numeric code to the named Slack account, submit now requires that exact
// code back - knowing someone's Slack id is no longer enough on its own.

const router = Router();

const MAX_ANSWER_LEN = 4000;
const MAX_ANSWERS = 30;
const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/;
const CODE_RE = /^\d{6}$/;

interface FormQuestion {
  key: string;
  label: string;
}

interface FormConfig {
  form_key: string;
  title: string;
  description: string;
  questions: FormQuestion[];
  close_at: string | null;
}

async function loadFormConfig(formKey: string): Promise<FormConfig | null> {
  const { data, error } = await supabase
    .from("form_configs")
    .select("form_key, title, description, questions, close_at")
    .eq("form_key", formKey)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as FormConfig;
}

// Public - apps/web-shell's form page fetches this to render the current
// title/description/questions and know whether submissions are closed.
router.get("/api/forms/:formKey/config", async (req, res) => {
  const config = await loadFormConfig(String(req.params.formKey));
  if (!config) return res.status(404).json({ ok: false });
  const closed = !!config.close_at && new Date(config.close_at).getTime() <= Date.now();
  res.json({
    ok: true,
    title: config.title,
    description: config.description,
    questions: config.questions,
    closeAt: config.close_at,
    closed,
  });
});

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
const APEX_URL = pixlConfig.urls.site;
function isTrustedOrigin(req: import("express").Request): boolean {
  const origin = req.headers.origin || req.headers.referer || "";
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(APEX_URL).host;
  } catch {
    return false;
  }
}

const verificationStore = createVerificationStore();

// Keyed by IP, separate from the per-slackId resend cooldown below - stops
// one IP from cycling through many different victims' ids just as much as
// it stops flooding a single one.
const codeRequestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: "form_request_code" });

router.post("/api/forms/:formKey/request-code", codeRequestLimiter, async (req, res) => {
  const formKey = String(req.params.formKey);
  if (!isTrustedOrigin(req)) return res.status(403).json({ ok: false, error: "bad_origin" });

  const config = await loadFormConfig(formKey);
  if (!config) return res.status(404).json({ ok: false, error: "form_not_found" });
  if (config.close_at && new Date(config.close_at).getTime() <= Date.now())
    return res.status(403).json({ ok: false, error: "form_closed" });

  const slackId = String(req.body?.slackId ?? "").trim();
  if (!SLACK_ID_RE.test(slackId))
    return res.status(400).json({ ok: false, error: "invalid_slack_id" });

  const key = `${formKey}:${slackId}`;
  // Whether or not this id resolves to a real Slack member never changes the
  // response below - only a successful lookup, on a key not already in its
  // resend cooldown, actually issues a code and sends a DM.
  const slackUser = await lookupSlackUser(slackId);
  if (slackUser) {
    try {
      const code = await verificationStore.issue(key, slackUser.name);
      if (code) {
        void dmSlackUser(
          slackId,
          `Your PIXL verification code for "${formKey}" is *${code}*. It expires in 10 minutes , if you didn't request this, ignore it.`,
        );
      }
    } catch (err) {
      console.error("[forms] issuing a verification code failed", (err as Error).message);
    }
  }
  res.json({ ok: true });
});

// Tighter than the app-wide write limiter (60/min) - this is a public,
// unauthenticated endpoint, worth its own low ceiling.
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: "form_submit" });

router.post("/api/forms/:formKey/submit", submitLimiter, async (req, res) => {
  const formKey = String(req.params.formKey);
  if (!isTrustedOrigin(req)) return res.status(403).json({ ok: false, error: "bad_origin" });

  const body = req.body as { answers?: unknown; website?: unknown; slackId?: unknown; code?: unknown };
  // Honeypot: a real user never fills this (CSS-hidden field). A bot filling
  // every input on the page will. Pretend success so a bot doesn't learn to
  // avoid it, but never actually store or notify on it.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.json({ ok: true });
  }

  const config = await loadFormConfig(formKey);
  if (!config) return res.status(404).json({ ok: false, error: "form_not_found" });
  if (config.close_at && new Date(config.close_at).getTime() <= Date.now())
    return res.status(403).json({ ok: false, error: "form_closed" });

  const slackId = String(body.slackId ?? "").trim();
  if (!SLACK_ID_RE.test(slackId))
    return res.status(400).json({ ok: false, error: "invalid_slack_id" });

  const code = String(body.code ?? "").trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ ok: false, error: "invalid_code" });

  const key = `${formKey}:${slackId}`;
  let name: string;
  let result: Awaited<ReturnType<typeof verificationStore.verify>>;
  try {
    name = (await verificationStore.peekName(key)) ?? slackId;
    result = await verificationStore.verify(key, code);
  } catch (err) {
    console.error("[forms] verification failed", (err as Error).message);
    return res.status(503).json({ ok: false, error: "verification_unavailable" });
  }
  if (result === "expired_or_missing")
    return res.status(400).json({ ok: false, error: "code_expired_or_missing" });
  if (result === "too_many_attempts")
    return res.status(429).json({ ok: false, error: "too_many_attempts" });
  if (result === "wrong_code") return res.status(400).json({ ok: false, error: "invalid_code" });

  const rawAnswers = body.answers;
  if (typeof rawAnswers !== "object" || rawAnswers === null || Array.isArray(rawAnswers))
    return res.status(400).json({ ok: false, error: "invalid_answers" });
  const entries = Object.entries(rawAnswers as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_ANSWERS)
    return res.status(400).json({ ok: false, error: "invalid_answers" });
  // Only keep answers for questions the form currently has configured -
  // guards against a stale client submitting a question that's since been
  // removed/renamed on the dashboard.
  const validKeys = new Set(config.questions.map((q) => q.key));
  const answers: Record<string, string> = {};
  for (const [k, value] of entries) {
    if (typeof k !== "string" || k.length > 100 || !validKeys.has(k)) continue;
    answers[k] = String(value ?? "").slice(0, MAX_ANSWER_LEN);
  }
  if (Object.keys(answers).length === 0)
    return res.status(400).json({ ok: false, error: "invalid_answers" });

  // One pending submission per person per form at a time - resubmitting
  // while still pending would just spam the reviewer queue and the "received"
  // DM; once a decision is made they're free to submit again.
  const { data: existingSubmission } = await supabase
    .from("form_submissions")
    .select("id")
    .eq("form_key", formKey)
    .eq("slack_id", slackId)
    .eq("status", "pending")
    .maybeSingle();
  if (existingSubmission) return res.status(409).json({ ok: false, error: "already_pending" });

  const ip = req.ip ?? "";
  const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";

  const { data: inserted, error } = await supabase
    .from("form_submissions")
    .insert({
      form_key: formKey,
      slack_id: slackId,
      name,
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
