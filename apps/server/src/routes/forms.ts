import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { supabase } from "../db/client.js";
import { rateLimit } from "../rateLimit.js";

// Public, no-account forms (e.g. pixl.hackclub.com/form/review). A submitter
// never gets a Pixl player account - they only prove their real Slack
// identity via Hack Club Auth (same OAuth apps/server's own player login
// uses, see routes/auth.ts, but a SEPARATE callback/flow here so this never
// creates a users row). That identity is what makes the "who do we DM"
// question safe: nobody can type someone else's Slack handle and get them
// DMed a fake application receipt/decision, the way a plain text field would
// allow.

const router = Router();

const APEX_URL = "https://pixl.hackclub.com";
const HCA_BASE_URL = "https://auth.hackclub.com";
const CLIENT_ID = process.env.HCA_CLIENT_ID!;
const CLIENT_SECRET = process.env.HCA_CLIENT_SECRET!;
const IDENTITY_COOKIE = "pixl_form_identity";
const STATE_COOKIE = "pixl_form_oauth_state";
const IDENTITY_TTL_MS = 30 * 60 * 1000;
const MAX_ANSWER_LEN = 4000;
const MAX_ANSWERS = 30;

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

// Distinct `purpose` claim, and deliberately no userId, so this can never be
// mistaken for (or escalated into) a real player session token even though
// it's signed with the same secret.
interface FormIdentity {
  purpose: "form_identity";
  formKey: string;
  slackId: string;
  name: string;
}

function callbackUrl(formKey: string): string {
  return `${APEX_URL}/api/forms/${encodeURIComponent(formKey)}/auth/callback`;
}

// This app doesn't use cookie-parser (every other route authenticates via a
// token in the query string, see the CORS comment in index.ts) - a tiny
// manual read is simpler than adding a dependency for two cookie names.
function readCookie(req: import("express").Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setCookie(res: import("express").Response, name: string, value: string, maxAgeMs: number) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: maxAgeMs,
    path: "/",
  });
}

// Defense in depth beyond SameSite=Lax (which already blocks the identity
// cookie from riding along on a cross-site POST): reject anything whose
// Origin/Referer isn't this apex, so even a same-site-cookie-adjacent bug
// elsewhere can't be leveraged into a forged submission.
function isTrustedOrigin(req: import("express").Request): boolean {
  const origin = req.headers.origin || req.headers.referer || "";
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(APEX_URL).host;
  } catch {
    return false;
  }
}

function readIdentity(req: import("express").Request): FormIdentity | null {
  const token = readCookie(req, IDENTITY_COOKIE);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, jwtSecret()) as unknown as FormIdentity;
    if (decoded?.purpose !== "form_identity" || !decoded.slackId) return null;
    return decoded;
  } catch {
    return null;
  }
}

router.get("/api/forms/:formKey/me", (req, res) => {
  const identity = readIdentity(req);
  if (!identity || identity.formKey !== req.params.formKey) {
    return res.json({ identified: false });
  }
  res.json({ identified: true, name: identity.name, slackId: identity.slackId });
});

router.get("/api/forms/:formKey/auth/start", (req, res) => {
  const formKey = req.params.formKey;
  const state = `${formKey}:${crypto.randomBytes(16).toString("hex")}`;
  setCookie(res, STATE_COOKIE, state, 10 * 60 * 1000);

  const url = new URL(`${HCA_BASE_URL}/oauth/authorize`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl(formKey));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile slack_id");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get("/api/forms/:formKey/auth/callback", async (req, res) => {
  const formKey = req.params.formKey;
  const fail = (reason: string) =>
    res.redirect(`${APEX_URL}/form/${encodeURIComponent(formKey)}?error=${encodeURIComponent(reason)}`);

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expected = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: "/" });
  if (!code || !state || !expected || state !== expected || !state.startsWith(`${formKey}:`))
    return fail("state");

  try {
    const tokenRes = await fetch(`${HCA_BASE_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: callbackUrl(formKey),
        code,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) return fail("token");
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail("token");

    const meRes = await fetch(`${HCA_BASE_URL}/api/v1/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!meRes.ok) return fail("identity");
    const me = (await meRes.json()) as {
      identity?: { first_name?: string; last_name?: string; slack_id?: string };
    };
    const slackId = me.identity?.slack_id;
    if (!slackId) return fail("no_slack");

    const name = [me.identity?.first_name, me.identity?.last_name].filter(Boolean).join(" ").trim() || slackId;
    const payload: FormIdentity = { purpose: "form_identity", formKey, slackId, name };
    const token = jwt.sign(payload, jwtSecret(), { expiresIn: "30m" });
    setCookie(res, IDENTITY_COOKIE, token, IDENTITY_TTL_MS);
    res.redirect(`${APEX_URL}/form/${encodeURIComponent(formKey)}`);
  } catch (e) {
    console.error("[forms] auth callback failed", e);
    fail("error");
  }
});

// Tighter than the app-wide write limiter (60/min) - this is a public,
// unauthenticated-until-Slack-verified endpoint, worth its own low ceiling.
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, name: "form_submit" });

router.post("/api/forms/:formKey/submit", submitLimiter, async (req, res) => {
  const formKey = req.params.formKey;
  if (!isTrustedOrigin(req)) return res.status(403).json({ ok: false, error: "bad_origin" });

  const identity = readIdentity(req);
  if (!identity || identity.formKey !== formKey)
    return res.status(401).json({ ok: false, error: "not_identified" });

  const body = req.body as { answers?: unknown; website?: unknown };
  // Honeypot: a real user never fills this (CSS-hidden field). A bot filling
  // every input on the page will. Pretend success so a bot doesn't learn to
  // avoid it, but never actually store or notify on it.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.json({ ok: true });
  }

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
    .eq("slack_id", identity.slackId)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return res.status(409).json({ ok: false, error: "already_pending" });

  const ip = req.ip ?? "";
  const ipHash = ip ? crypto.createHash("sha256").update(ip).digest("hex") : "";

  const { data: inserted, error } = await supabase
    .from("form_submissions")
    .insert({
      form_key: formKey,
      slack_id: identity.slackId,
      name: identity.name,
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
    identity.slackId,
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
