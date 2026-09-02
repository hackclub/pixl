import { GABIN_ID, RIDIT_ID, RICKY_ID } from "../constants.js";

// Per-user sliding-window limiter shared by every AI (OpenRouter) and search
// (Brave) call site, slash commands and the in-thread chat pipeline alike,
// so one person spamming can't burn through the workspace's shared credits.

const buckets = new Map<string, number[]>();
let callsSinceSweep = 0;

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// 8 AI-triggering actions per minute is generous for a real conversation
// (each slash command / thread reply is one hit) but stops a tight loop of
// spam commands or repeated pings from draining credits.
export const DEFAULT_AI_RATE_LIMIT: RateLimitOptions = { max: 8, windowMs: 60_000 };

export const AI_RATE_LIMIT_MESSAGE = "chill for a sec, you're spamming me 💀 try again in a bit";

// The orgs run this thing and are constantly testing it, and 8/min is a
// couple of minutes of debugging before Pixo starts refusing them in their
// own workspace. They still get a ceiling so a runaway loop can't drain the
// credits, just a far less annoying one.
const ORG_IDS = new Set([GABIN_ID, RIDIT_ID, RICKY_ID]);
export const ORG_AI_RATE_LIMIT: RateLimitOptions = { max: 60, windowMs: 60_000 };

export function checkAiRateLimit(userId: string, opts?: RateLimitOptions): boolean {
  opts ??= ORG_IDS.has(userId) ? ORG_AI_RATE_LIMIT : DEFAULT_AI_RATE_LIMIT;
  const now = Date.now();
  const arr = (buckets.get(userId) ?? []).filter((t) => now - t < opts.windowMs);

  if (arr.length >= opts.max) {
    if (arr.length) buckets.set(userId, arr);
    else buckets.delete(userId);
    return false;
  }

  arr.push(now);
  buckets.set(userId, arr);

  // Occasionally sweep every bucket, not just this user's, so entries for
  // people who've gone quiet get dropped instead of sitting in memory for
  // the rest of the process lifetime.
  if (++callsSinceSweep >= 200) {
    callsSinceSweep = 0;
    for (const [uid, times] of buckets) {
      if (!times.some((t) => now - t < opts.windowMs)) buckets.delete(uid);
    }
  }

  return true;
}
