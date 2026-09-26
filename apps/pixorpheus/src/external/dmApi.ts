import crypto from "crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { app, receiver } from "../slack/app.js";
import { isSlackUserId } from "../slack/pixlMembership.js";

// Lets the Pixl HQ dashboard (apps/dashboard) deliver every player-facing DM
// (review approved/sent back, shop order claimed/shipped/cancelled, warns,
// ...) through this bot instead of the dashboard's own separate, narrower
// Slack app - so players see them coming from Pixo, one consistent identity,
// instead of an "internal Pixl dashboard" account. dmUser() in
// apps/dashboard/lib/slack.ts already has this call built in behind
// EXTERNAL_DM_URL/EXTERNAL_API_KEY; this is the endpoint it POSTs to
// ({ userId, message }), same contract apps/pixo-dm's standalone relay
// already implements on Railway - this is the Orchard-side equivalent, with
// the same abuse protections, so either can be pointed at safely.
const MAX_MESSAGE_LENGTH = 3000;
const GLOBAL_RATE_LIMIT = 60; // requests/minute, total
const PER_USER_RATE_LIMIT = 5; // messages/minute, per userId
const RATE_WINDOW_MS = 60_000;
// A per-minute cap alone doesn't bound a slow, sustained campaign spread
// across many real users - this daily ceiling limits total blast radius if
// the API key ever leaks.
const DAILY_GLOBAL_LIMIT = Number(process.env.PIXO_DM_DAILY_LIMIT) || 1000;
const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;

let globalHits: number[] = [];
let dailyHits: number[] = [];
const perUserHits = new Map<string, number[]>();

function pruneOld(hits: number[], now: number, windowMs: number): number[] {
  while (hits.length && now - hits[0] > windowMs) hits.shift();
  return hits;
}

// perUserHits would otherwise grow forever - one entry per distinct userId
// ever messaged - since nothing deletes a key once its hits age out.
setInterval(() => {
  const now = Date.now();
  for (const [userId, hits] of perUserHits) {
    if (pruneOld(hits, now, RATE_WINDOW_MS).length === 0) perUserHits.delete(userId);
  }
}, RATE_WINDOW_MS).unref();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  pruneOld(globalHits, now, RATE_WINDOW_MS);
  if (globalHits.length >= GLOBAL_RATE_LIMIT) return true;
  pruneOld(dailyHits, now, DAY_WINDOW_MS);
  if (dailyHits.length >= DAILY_GLOBAL_LIMIT) return true;
  const userHits = pruneOld(perUserHits.get(userId) || [], now, RATE_WINDOW_MS);
  if (userHits.length >= PER_USER_RATE_LIMIT) return true;
  globalHits.push(now);
  dailyHits.push(now);
  userHits.push(now);
  perUserHits.set(userId, userHits);
  return false;
}

// Same auth pattern as ticketApi.ts's requireExternalApiKey - duplicated
// rather than shared since it's four lines and this file has no other
// dependency on that one.
function requireExternalApiKey(req: Request, res: Response, next: NextFunction) {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key) return res.status(503).json({ error: "API key not configured" });
  const provided = req.headers["x-api-key"];
  const providedBuf = Buffer.from(typeof provided === "string" ? provided : "");
  const keyBuf = Buffer.from(key);
  const valid = providedBuf.length === keyBuf.length && crypto.timingSafeEqual(providedBuf, keyBuf);
  if (!valid) return res.status(401).json({ error: "Invalid API key" });
  next();
}

receiver.app.post("/api/external/dm", express.json(), requireExternalApiKey, async (req, res) => {
  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!userId || !isSlackUserId(userId)) return res.status(400).json({ error: "Invalid Slack user ID" });
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (message.length > MAX_MESSAGE_LENGTH)
    return res.status(400).json({ error: `message exceeds ${MAX_MESSAGE_LENGTH} characters` });
  if (isRateLimited(userId)) return res.status(429).json({ error: "Rate limit exceeded" });

  try {
    // channel: a user id opens (or reuses) the DM, same as a channel id would
    // open a channel - no separate "open a DM" call needed first.
    await app.client.chat.postMessage({ channel: userId, text: message });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[external-dm] send failed:", e?.message ?? e);
    res.status(502).json({ error: "delivery_failed" });
  }
});
