import { Router } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { fetchHackatimeStats, fetchProjectActivitySummary, HACKATIME_CUTOFF } from "../hackatime/api.js";
import { config } from "../config.generated.js";

// OAuth app config - set these as env vars on the server (never in the repo).
const BASE = (process.env.HACKATIME_BASE ?? "https://hackatime.hackclub.com").replace(/\/$/, "");
const CLIENT_ID = process.env.HACKATIME_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HACKATIME_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.HACKATIME_REDIRECT_URI ?? `${config.urls.server}/hackatime/callback`;
const SCOPES = process.env.HACKATIME_SCOPES ?? "profile read";

function configured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

// Stateless signed `state` so we can verify the OAuth round-trip without a
// session store: it carries the user id and an expiry, HMAC'd with the secret.
function signState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ a: userId, e: Date.now() + 10 * 60 * 1000 }),
  ).toString("base64url");
  const mac = createHmac("sha256", CLIENT_SECRET).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verifyState(state: string): string | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const expected = createHmac("sha256", CLIENT_SECRET).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(state.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof obj.a !== "string" || typeof obj.e !== "number") return null;
    if (Date.now() > obj.e) return null;
    return obj.a;
  } catch {
    return null;
  }
}

function page(message: string): string {
  return (
    `<!doctype html><meta charset="utf-8">` +
    `<body style="margin:0;background:#141009;color:#f4e3c2;font-family:monospace;` +
    `display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">` +
    `<div style="font-size:18px;max-width:420px;padding:24px">${message}</div></body>`
  );
}

const router = Router();

// Kick off the OAuth flow. Godot opens this URL in the browser; we bounce the
// user to HackTime's consent screen carrying a signed state.
router.get("/hackatime/connect", (req, res) => {
  if (!configured()) {
    return res
      .status(503)
      .send(page("HackTime OAuth is not configured on the server."));
  }
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).send(page("Please log in first."));

  const state = signState(session.userId);
  const url =
    `${BASE}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

// HackTime redirects back here with a code; exchange it for an access token and
// store it on the user.
router.get("/hackatime/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const userId = state ? verifyState(state) : null;
  if (!code || !userId) return res.status(400).send(page("Connection failed: invalid request."));

  try {
    const tokenRes = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) return res.status(502).send(page("HackTime rejected the login."));

    const data = (await tokenRes.json()) as { access_token?: string };
    if (!data.access_token) return res.status(502).send(page("HackTime returned no token."));

    const { data: updated, error } = await supabase
      .from("users")
      .update({ hackatime_token: data.access_token })
      .eq("id", userId)
      .select("id");
    if (error || !updated || updated.length === 0) {
      console.error("[hackatime] failed to save token", { userId, error, matched: updated?.length ?? 0 });
      return res.status(500).send(page("Could not save your connection, no matching account. Try reopening the page from the game."));
    }

    console.log("[hackatime] token saved for", userId);
    res.send(page("✅ HackTime connected! You can close this tab and return to the game."));
  } catch (e) {
    console.error("[hackatime] callback failed", e);
    res.status(500).send(page("Something went wrong connecting HackTime."));
  }
});

// Current connection state + per-project time for the logged-in user.
router.get("/api/hackatime/stats", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data } = await supabase
    .from("users")
    .select("hackatime_token, slack_id")
    .eq("id", session.userId)
    .single();
  const row = data as { hackatime_token?: string; slack_id?: string } | null;
  const htToken = row?.hackatime_token ?? null;
  const slackId = row?.slack_id ?? null;
  const stats = await fetchHackatimeStats(htToken);
  // Flag projects with any activity before the event cutoff so the picker can
  // warn "only time after the cutoff counts" before the player links one. Capped
  // to the top 40 by tracked time so a prolific account doesn't fan out into
  // dozens of Hackatime API calls.
  if (stats.connected && slackId) {
    const toCheck = [...stats.projects].sort((a, b) => b.seconds - a.seconds).slice(0, 40);
    const summaries = await Promise.all(
      toCheck.map((p) => fetchProjectActivitySummary(slackId, htToken, p.name)),
    );
    const byName = new Map(toCheck.map((p, i) => [p.name, summaries[i]]));
    stats.projects = stats.projects.map((p) => {
      const s = byName.get(p.name);
      if (!s) return p;
      return {
        ...p,
        beforeCutoff: s.firstActivity != null && s.firstActivity < HACKATIME_CUTOFF,
        secondsSinceCutoff: s.secondsSinceCutoff,
      };
    });
  }
  res.json({ ok: true, stats });
});

export default router;
