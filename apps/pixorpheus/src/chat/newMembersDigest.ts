import { app } from "../slack/app.js";
import { PIXL_MAIN_CHANNEL } from "../constants.js";
import { db } from "../db/client.js";
import { welcomeThreads } from "./thread.js";
import { hasLaunched } from "../config.generated.js";

// End-of-day "new members" digest. Replaces the instant per-join welcome in the
// main channel: every join is recorded in member_joins (see welcomeMessages.ts),
// and once a day we post a single message welcoming everyone who joined.
//
// Time/timezone are configurable; default is 21:00 Europe/Paris. The schedule
// recomputes the next fire time after each run, so it stays correct across DST.
const DIGEST_HOUR = Math.min(23, Math.max(0, Number(process.env.NEW_MEMBERS_DIGEST_HOUR ?? 21)));
const DIGEST_TZ = process.env.NEW_MEMBERS_DIGEST_TZ ?? "Europe/Paris";

// Team subteam, cc'd once per digest (same group the old instant welcome cc'd).
const TEAM_SUBTEAM = "S0BFM30573R";

/** Record a main-channel join for the daily digest. Idempotent per user. */
export async function recordMemberJoin(userId: string, channel: string): Promise<void> {
  try {
    await db()
      .from("member_joins")
      .upsert({ user_id: userId, channel }, { onConflict: "user_id", ignoreDuplicates: true });
  } catch (e: any) {
    console.error("[new-members-digest] record failed:", e?.message ?? e);
  }
}

/** Post the digest for everyone not yet announced, then mark them announced. */
export async function postNewMembersDigest(): Promise<void> {
  const { data: rows } = await db()
    .from("member_joins")
    .select("*")
    .eq("channel", PIXL_MAIN_CHANNEL)
    .eq("announced", false)
    .order("joined_at", { ascending: true });

  const ids = (rows ?? []).map((r: any) => String(r.user_id));
  if (ids.length === 0) return; // nobody new today, stay quiet

  const mentions = ids.map((id) => `<@${id}>`).join(" ");
  const header =
    ids.length === 1 ? "a new member joined today" : `${ids.length} new members joined today`;
  const text = hasLaunched()
    ? `:pixel_heart: *${header}!* welcome ${mentions} - go ship something and earn your first pixels in <#${PIXL_MAIN_CHANNEL}> !!`
    : `:pixel_heart: *${header}!* welcome ${mentions} - pixl launches soon, you're early :yay:`;

  const posted = await app.client.chat.postMessage({ channel: PIXL_MAIN_CHANNEL, text });
  if (posted.ts) {
    welcomeThreads.add(posted.ts);
    await app.client.chat.postMessage({
      channel: PIXL_MAIN_CHANNEL,
      thread_ts: posted.ts,
      text: `cc <!subteam^${TEAM_SUBTEAM}>`,
    });
  }

  // Only after a successful post, so a failure keeps them queued for next time.
  await db().from("member_joins").update({ announced: true }).in("user_id", ids);
}

/** Milliseconds until the next DIGEST_HOUR:00 in DIGEST_TZ. */
function msUntilNextDigest(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DIGEST_TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const h = get("hour") % 24; // en-US can render midnight as "24"
  const nowSec = h * 3600 + get("minute") * 60 + get("second");
  let untilSec = DIGEST_HOUR * 3600 - nowSec;
  if (untilSec <= 0) untilSec += 24 * 3600;
  return untilSec * 1000;
}

/** Start the daily digest loop. Reschedules itself after every run. */
export function scheduleNewMembersDigest(): void {
  const delay = msUntilNextDigest();
  setTimeout(() => {
    postNewMembersDigest()
      .catch((e) => console.error("[new-members-digest] post failed:", e?.message ?? e))
      .finally(() => scheduleNewMembersDigest());
  }, delay);
}
