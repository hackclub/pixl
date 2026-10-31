import { db } from "@/lib/db";
import { isValidTicketTs } from "./requestGuards";
import { externalTicketsUrl } from "./pixo";
import { callPixo, PIXO_OFFLINE_MESSAGE, type PixoCallDeps } from "./pixoCall";

export interface TicketStats {
  total: number;
  open: number;
  resolved: number;
}

export interface Ticket {
  msg_ts: string;
  description: string;
  title: string;
  status: string;
  opened_by_slack_id: string;
  permalink: string | null;
}

export interface FullTicketRow {
  msg_ts: string;
  description: string | null;
  title: string | null;
  status: string;
  opened_by_slack_id: string;
  claimed_by_slack_id: string | null;
  closed_by_slack_id: string | null;
  permalink: string | null;
  ticket_number: number | null;
  title_prompt_ts: string | null;
}

export interface ThreadMessage {
  ts: string;
  text: string;
  name: string;
  avatar: string | null;
  isFirst: boolean;
  isBot: boolean;
}

export async function countOpenTickets(): Promise<number> {
  try {
    const { count } = await db.from("tickets").select("id", { count: "exact", head: true }).eq("status", "open");
    return count ?? 0;
  } catch (e) {
    console.error("countOpenTickets", (e as Error).message);
    return 0;
  }
}

export async function ticketStats(): Promise<TicketStats> {
  try {
    const [{ count: total }, { count: open }, { count: resolved }] = await Promise.all([
      db.from("tickets").select("*", { count: "exact", head: true }),
      db.from("tickets").select("*", { count: "exact", head: true }).eq("status", "open"),
      db.from("tickets").select("*", { count: "exact", head: true }).eq("status", "closed"),
    ]);
    return { total: total ?? 0, open: open ?? 0, resolved: resolved ?? 0 };
  } catch (e) {
    console.error("ticketStats", (e as Error).message);
    return { total: 0, open: 0, resolved: 0 };
  }
}

export async function listTickets(
  status: "open" | "closed" | "all" = "open",
  search = "",
): Promise<Ticket[]> {
  try {
    let q = db.from("tickets").select("*").order("msg_ts", { ascending: false }).limit(200);
    if (status !== "all") q = q.eq("status", status);
    if (search.trim()) q = q.ilike("description", `%${search.trim()}%`);
    const { data } = await q;
    return (data ?? []) as Ticket[];
  } catch (e) {
    console.error("listTickets", (e as Error).message);
    return [];
  }
}

export interface ActivityPoint {
  date: string;
  created: number;
  resolved: number;
}

export async function ticketActivity(): Promise<ActivityPoint[]> {
  try {
    const cutoff = new Date(Date.now() - 30 * 86400_000);
    const [{ data: all }, { data: closed }] = await Promise.all([
      db.from("tickets").select("msg_ts, closed_at"),
      db.from("tickets").select("closed_at").eq("status", "closed"),
    ]);

    const cMap = new Map<string, number>();
    const rMap = new Map<string, number>();

    for (const t of all ?? []) {
      const d = new Date(parseFloat(t.msg_ts) * 1000);
      if (d >= cutoff) {
        const key = d.toISOString().slice(0, 10);
        cMap.set(key, (cMap.get(key) ?? 0) + 1);
      }
    }
    for (const t of closed ?? []) {
      if (t.closed_at) {
        const d = new Date(t.closed_at);
        if (d >= cutoff) {
          const key = d.toISOString().slice(0, 10);
          rMap.set(key, (rMap.get(key) ?? 0) + 1);
        }
      }
    }

    const out: ActivityPoint[] = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, created: cMap.get(key) ?? 0, resolved: rMap.get(key) ?? 0 });
    }
    return out;
  } catch (e) {
    console.error("ticketActivity", (e as Error).message);
    return [];
  }
}

export interface ResolverRow {
  slackId: string;
  total: number;
  last7d: number;
  last30d: number;
}

// Who resolved the most tickets, all-time plus the trailing 7 and 30 days. Tickets
// resolved before closed_by_slack_id existed (or reopened, which nulls it)
// just don't count toward anyone.
export async function resolverLeaderboard(): Promise<ResolverRow[]> {
  try {
    const weekAgo = Date.now() - 7 * 86400_000;
    const monthAgo = Date.now() - 30 * 86400_000;
    const counts = new Map<string, ResolverRow>();
    // Paged since PostgREST caps a single select at 1000 rows.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("tickets")
        .select("closed_by_slack_id, closed_at")
        .eq("status", "closed")
        .not("closed_by_slack_id", "is", null)
        .order("msg_ts", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const t of data ?? []) {
        const id = t.closed_by_slack_id as string;
        const row = counts.get(id) ?? { slackId: id, total: 0, last7d: 0, last30d: 0 };
        row.total++;
        const closedAt = t.closed_at ? new Date(t.closed_at).getTime() : 0;
        if (closedAt >= weekAgo) row.last7d++;
        if (closedAt >= monthAgo) row.last30d++;
        counts.set(id, row);
      }
      if (!data || data.length < PAGE) break;
    }
    return [...counts.values()].sort((a, b) => b.total - a.total || b.last7d - a.last7d);
  } catch (e) {
    console.error("resolverLeaderboard", (e as Error).message);
    return [];
  }
}

// Form-encoded, not JSON , users.info in particular silently fails to read
// its `user` param from a JSON body. Complex values (arrays/objects, e.g.
// chat.postMessage's `blocks`) get JSON-stringified into their form field,
// which Slack expects.
function toFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return params;
}

async function slackFetch(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toFormBody(body),
  });
  return (await res.json()) as Record<string, unknown> & { ok: boolean; error?: string };
}

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string | undefined,
  ) {
    super(`Slack ${method} failed: ${code}`);
  }
}

// What Slack answers once a ticket's root message has been deleted. Retrying
// never helps, so callers should treat the thread as gone, not as failing.
export function isMissingThread(e: unknown): boolean {
  return (
    e instanceof SlackApiError &&
    (e.code === "thread_not_found" || e.code === "message_not_found")
  );
}

async function slackCall(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let json = await slackFetch(method, body);
  // The dashboard bot isn't auto-added to the help channel the way Pixorpheus
  // is, so writes come back `not_in_channel`. Self-join the (public) channel
  // and retry once. Private channels still need a manual invite.
  if (!json.ok && json.error === "not_in_channel" && typeof body.channel === "string") {
    const joined = await slackFetch("conversations.join", { channel: body.channel });
    if (joined.ok) json = await slackFetch(method, body);
  }
  if (!json.ok) throw new SlackApiError(method, json.error);
  return json;
}

const userCache = new Map<string, { name: string; avatar: string | null }>();

async function getSlackUser(id: string) {
  const hit = userCache.get(id);
  if (hit) return hit;
  try {
    const res = (await slackCall("users.info", { user: id })) as {
      user?: { profile?: { display_name?: string; real_name?: string; image_72?: string } };
    };
    const p = res.user?.profile;
    const info = {
      name: p?.display_name || p?.real_name || id,
      avatar: p?.image_72 ?? null,
    };
    userCache.set(id, info);
    setTimeout(() => userCache.delete(id), 5 * 60_000);
    return info;
  } catch {
    return { name: id, avatar: null };
  }
}

export async function ticketThread(ts: string): Promise<ThreadMessage[]> {
  if (!isValidTicketTs(ts)) throw new Error("Invalid ticket id");
  const channel = process.env.SLACK_HELP_CHANNEL;
  if (!channel) throw new Error("SLACK_HELP_CHANNEL is not set");
  const res = (await slackCall("conversations.replies", {
    channel,
    ts,
    limit: 200,
  })) as { messages?: { ts: string; text: string; user?: string; username?: string; bot_id?: string; icons?: { image_72?: string } }[] };
  const messages = res.messages ?? [];
  return Promise.all(
    messages.map(async (msg, i) => {
      let name = msg.username || "Bot";
      let avatar = msg.icons?.image_72 ?? null;
      if (msg.user) {
        const u = await getSlackUser(msg.user);
        name = u.name;
        avatar = u.avatar;
      }
      return {
        ts: msg.ts,
        text: msg.text,
        name,
        avatar,
        isFirst: i === 0,
        isBot: !!msg.bot_id,
      };
    }),
  );
}

export async function ticketReply(
  ts: string,
  text: string,
  actor: { slackId?: string; username?: string },
): Promise<void> {
  if (!isValidTicketTs(ts)) throw new Error("Invalid ticket id");
  const channel = process.env.SLACK_HELP_CHANNEL;
  if (!channel) throw new Error("SLACK_HELP_CHANNEL is not set");
  let username = actor.username || "Support";
  let icon_url: string | null = null;
  if (actor.slackId) {
    const u = await getSlackUser(actor.slackId);
    username = u.name;
    icon_url = u.avatar;
  }
  const body: Record<string, unknown> = {
    channel,
    thread_ts: ts,
    text: text.trim(),
    username,
  };
  if (icon_url) body.icon_url = icon_url;
  await slackCall("chat.postMessage", body);
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  alreadyClosed?: boolean;
  /** Set when Pixo was offline and the dashboard resolved it on its own. */
  notice?: string;
}

export const PIXO_OFFLINE_RESOLVE_NOTICE = `${PIXO_OFFLINE_MESSAGE} Resolved here instead; the Slack thread may not show it until Pixo is back.`;

// Resolve a ticket via Pixorpheus's bot instead of the dashboard's own Slack
// app , the dashboard's bot isn't reliably a member of the help channel (and
// lacks the scope to self-join), so posting the resolved message straight
// from here was silently failing. Pixorpheus's bot already lives in the
// channel and already has a working "Mark resolved" flow, so this just asks
// it to replay that exact flow via its EXTERNAL_API_KEY-guarded API instead
// of duplicating the Slack calls with a weaker token.
// Never throws. Returns "offline" when Pixo didn't answer (stopped,
// unreachable, timed out, 5xx) so the caller can resolve without it.
export async function resolveViaPixorpheus(
  url: string,
  key: string,
  ts: string,
  actor: { slackId: string; username: string },
  deps?: PixoCallDeps,
): Promise<ResolveResult | "offline"> {
  if (!isValidTicketTs(ts)) return { ok: false, error: "Invalid ticket id." };
  const r = await callPixo(
    "tickets.resolve",
    `${url}/${encodeURIComponent(ts)}/resolve`,
    {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ slackId: actor.slackId, username: actor.username }),
    },
    deps,
  );
  if (r.ok) return { ok: true };
  if (r.offline || !r.res) return "offline";
  let msg = "";
  try {
    msg = ((await r.res.json()) as { error?: string }).error ?? "";
  } catch {}
  if (r.status === 400 && /already resolved/i.test(msg)) return { ok: true, alreadyClosed: true };
  if (r.status === 404) return { ok: false, error: "No ticket found for this message." };
  return { ok: false, error: msg || `Pixorpheus resolve failed (${r.status})` };
}

// Resolve a ticket straight from the dashboard. Routes through Pixorpheus
// (see resolveViaPixorpheus) whenever EXTERNAL_API_KEY is configured, at
// EXTERNAL_TICKETS_URL or Pixo's in-cluster address by default (lib/pixo.ts).
// Without the key, or when Pixo is offline, it closes the row and runs the
// Slack side-effects directly from here (best-effort), so staff are never
// blocked by Pixo being down.
export async function resolveTicketFromDash(
  ts: string,
  actor: { slackId: string; username: string },
): Promise<ResolveResult> {
  if (!isValidTicketTs(ts)) return { ok: false, error: "Invalid ticket id." };
  const extKey = process.env.EXTERNAL_API_KEY;
  if (extKey) {
    const viaPixo = await resolveViaPixorpheus(externalTicketsUrl(), extKey, ts, actor);
    if (viaPixo !== "offline") return viaPixo;
    const direct = await resolveDirectly(ts, actor);
    return direct.ok && !direct.alreadyClosed ? { ...direct, notice: PIXO_OFFLINE_RESOLVE_NOTICE } : direct;
  }
  return resolveDirectly(ts, actor);
}

async function resolveDirectly(
  ts: string,
  actor: { slackId: string; username: string },
): Promise<ResolveResult> {

  const { data: ticket, error: readError } = await db
    .from("tickets")
    .select("status")
    .eq("msg_ts", ts)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!ticket) return { ok: false, error: "No ticket found for this message." };
  if (ticket.status === "closed") return { ok: true, alreadyClosed: true };

  const { data: updated, error } = await db
    .from("tickets")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by_slack_id: actor.slackId,
    })
    .eq("msg_ts", ts)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  const ticketRow = updated as FullTicketRow;

  // Slack side-effects are best-effort , the DB row is the source of truth.
  const channel = process.env.SLACK_HELP_CHANNEL;
  if (channel) {
    try {
      await slackCall("chat.postMessage", {
        channel,
        thread_ts: ts,
        text: `Ticket resolved by <@${actor.slackId}>!`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `Resolved by <@${actor.slackId}>! If you have more questions, feel free to open a new thread.` },
          },
          {
            type: "actions",
            elements: [{ type: "button", action_id: "reopen_ticket", text: { type: "plain_text", text: "Reopen" }, value: ts }],
          },
        ],
      });
    } catch (e) {
      console.error(`resolveTicketFromDash: failed to post resolved note for ${ts}:`, e);
    }

    try {
      await slackCall("reactions.add", { channel, timestamp: ts, name: "white_check_mark" });
    } catch (e) {
      console.error(`resolveTicketFromDash: failed to add checkmark reaction for ${ts}:`, e);
    }
    try {
      await slackCall("reactions.remove", { channel, timestamp: ts, name: "thinking_face" });
    } catch (e) {
      console.error(`resolveTicketFromDash: failed to remove thinking reaction for ${ts}:`, e);
    }

    if (ticketRow.title_prompt_ts) {
      try {
        await slackCall("chat.delete", { channel, ts: ticketRow.title_prompt_ts });
      } catch (e) {
        console.error(`resolveTicketFromDash: failed to delete title prompt for ${ts}:`, e);
      }
      db.from("tickets").update({ title_prompt_ts: null }).eq("msg_ts", ts).then(
        () => {},
        () => {},
      );
    }
  }
  return { ok: true };
}