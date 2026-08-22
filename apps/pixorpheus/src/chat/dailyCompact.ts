import type { WebClient } from "@slack/web-api";
import { app } from "../slack/app.js";
import { PIXL_MAIN_CHANNEL } from "../constants.js";
import { db } from "../db/client.js";
import { aiPost } from "../ai/client.js";
import { ensureUserName, getDisplayName } from "../memory/users.js";

// Pixo's "/compact" feature (see pixo:compact in messageHandler.ts): an
// end-of-day summary of #pixl, generated once per day and stored silently —
// never posted on its own. A player only ever sees it by asking.
//
// Time/timezone are configurable the same way newMembersDigest.ts is; default
// is 00:05 Europe/Paris so it fires just after the day it's summarizing ends.
const COMPACT_HOUR = Math.min(23, Math.max(0, Number(process.env.DAILY_COMPACT_HOUR ?? 0)));
const COMPACT_MINUTE = Math.min(59, Math.max(0, Number(process.env.DAILY_COMPACT_MINUTE ?? 5)));
export const COMPACT_TZ = process.env.DAILY_COMPACT_TZ ?? "Europe/Paris";

interface CompactMessage {
  user?: string;
  text?: string;
}

/** The TZ's UTC offset (minutes, positive east of UTC) at a given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUTC - at.getTime()) / 60000;
}

/**
 * [oldest, latest) unix-second bounds for one local calendar day in `tz`,
 * `daysAgo` days back from today, plus that day's date string ("YYYY-MM-DD").
 * Approximate right at a DST transition (uses "now"'s offset throughout),
 * same tolerance newMembersDigest.ts already accepts for its own schedule.
 */
function localDayRangeUnix(tz: string, daysAgo: number): { startSec: number; endSec: number; dateStr: string } {
  const now = new Date();
  const offsetMs = tzOffsetMinutes(tz, now) * 60000;
  const wallNow = now.getTime() + offsetMs;
  const wallMidnightToday = Math.floor(wallNow / 86400000) * 86400000;
  const wallMidnightTarget = wallMidnightToday - daysAgo * 86400000;
  const startMs = wallMidnightTarget - offsetMs;
  return {
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor((startMs + 86400000) / 1000),
    dateStr: new Date(wallMidnightTarget).toISOString().slice(0, 10),
  };
}

async function fetchChannelMessages(
  client: WebClient,
  channel: string,
  oldestSec: number,
  latestSec: number,
): Promise<CompactMessage[]> {
  const data = await client.conversations.history({
    channel,
    oldest: String(oldestSec),
    latest: String(latestSec),
    limit: 1000,
  });
  return (data.messages || []).filter((msg) => msg.text && !msg.bot_id).reverse();
}

async function summarizeMessages(client: WebClient, msgs: CompactMessage[]): Promise<string | null> {
  if (!msgs.length) return null;
  await Promise.all(
    [...new Set(msgs.map((msg) => msg.user).filter(Boolean) as string[])].map((uid) => ensureUserName(uid, client)),
  );
  const combined = msgs.map((msg) => `${getDisplayName(msg.user) || msg.user || "someone"}: ${msg.text}`).join("\n");
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content:
            "Summarize a full day of Slack conversation concisely in 5-10 bullet points. Focus on key topics, decisions, ships, and anything actionable. English only. No intro sentence, just the bullets.",
        },
        { role: "user", content: combined.slice(0, 12000) },
      ],
      max_tokens: 500,
    });
    return res.data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e: any) {
    console.error("[daily-compact] summarize failed:", e?.message ?? e);
    return null;
  }
}

/**
 * Generates and stores the compact for one local day (default: yesterday,
 * the day that just ended) in `channel`. Silent on a quiet day — nothing to
 * store just means no row, not an empty one.
 */
export async function generateDailyCompact(daysAgo = 1, channel = PIXL_MAIN_CHANNEL): Promise<void> {
  const { startSec, endSec, dateStr } = localDayRangeUnix(COMPACT_TZ, daysAgo);
  try {
    const msgs = await fetchChannelMessages(app.client, channel, startSec, endSec);
    if (!msgs.length) return;
    const summary = await summarizeMessages(app.client, msgs);
    if (!summary) return;
    await db()
      .from("daily_compacts")
      .upsert(
        { channel_id: channel, compact_date: dateStr, summary, message_count: msgs.length },
        { onConflict: "channel_id,compact_date" },
      );
  } catch (e: any) {
    console.error("[daily-compact] generate failed:", e?.message ?? e);
  }
}

/** The stored compact for a given local date ("YYYY-MM-DD"), if one exists. */
export async function getStoredCompact(
  dateStr: string,
  channel = PIXL_MAIN_CHANNEL,
): Promise<{ summary: string; messageCount: number } | null> {
  const { data } = await db()
    .from("daily_compacts")
    .select("summary, message_count")
    .eq("channel_id", channel)
    .eq("compact_date", dateStr)
    .maybeSingle();
  if (!data) return null;
  return { summary: (data as any).summary, messageCount: (data as any).message_count };
}

/** Live-computes a compact for "today so far" — there's no stored row for an in-progress day. */
export async function computeCompactSince(
  daysAgo: number,
  channel = PIXL_MAIN_CHANNEL,
): Promise<{ summary: string; messageCount: number } | null> {
  const { startSec, endSec } = localDayRangeUnix(COMPACT_TZ, daysAgo);
  const msgs = await fetchChannelMessages(app.client, channel, startSec, Math.min(endSec, Math.floor(Date.now() / 1000)));
  if (!msgs.length) return null;
  const summary = await summarizeMessages(app.client, msgs);
  if (!summary) return null;
  return { summary, messageCount: msgs.length };
}

/** "YYYY-MM-DD" for `daysAgo` days back from today, in COMPACT_TZ. */
export function compactDateStr(daysAgo: number): string {
  return localDayRangeUnix(COMPACT_TZ, daysAgo).dateStr;
}

/** Ms until the next COMPACT_HOUR:COMPACT_MINUTE in COMPACT_TZ. */
function msUntilNextRun(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPACT_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const h = get("hour") % 24;
  const nowSec = h * 3600 + get("minute") * 60 + get("second");
  let untilSec = COMPACT_HOUR * 3600 + COMPACT_MINUTE * 60 - nowSec;
  if (untilSec <= 0) untilSec += 24 * 3600;
  return untilSec * 1000;
}

/** Starts the daily compact loop. Reschedules itself after every run. */
export function scheduleDailyCompact(): void {
  const delay = msUntilNextRun();
  setTimeout(() => {
    generateDailyCompact(1).finally(() => scheduleDailyCompact());
  }, delay);
}
