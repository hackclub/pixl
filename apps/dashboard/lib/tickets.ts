import { db } from "@/lib/db";

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

interface FullTicketRow {
  msg_ts: string;
  description: string | null;
  title: string | null;
  status: string;
  opened_by_slack_id: string;
  claimed_by_slack_id: string | null;
  closed_by_slack_id: string | null;
  permalink: string | null;
  ticket_msg_ts: string | null;
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
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error}`);
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
}

// Mirrors Pixorpheus's own `ticketBlocks(ticket)` so the ticket-channel card
// looks and behaves identically no matter which side resolved it.
function ticketBlocks(ticket: FullTicketRow) {
  const { description, title, opened_by_slack_id, status, claimed_by_slack_id, closed_by_slack_id, ticket_number, permalink } = ticket;
  const msg_ts = ticket.msg_ts == null ? "" : String(ticket.msg_ts);
  const safeDescription = description || "";
  const displayTitle =
    title || (safeDescription.length > 80 ? safeDescription.substring(0, 80) + "..." : safeDescription) || "(no description)";

  let statusText: string;
  if (status === "closed") statusText = closed_by_slack_id ? `✅ Resolved by <@${closed_by_slack_id}>` : "✅ Resolved";
  else if (claimed_by_slack_id) statusText = `🟡 Claimed by <@${claimed_by_slack_id}>`;
  else statusText = "🔴 Open - not claimed";

  const actionElements =
    status === "closed"
      ? [
          {
            type: "button",
            text: { type: "plain_text", text: "Reopen" },
            action_id: "reopen_ticket",
            value: msg_ts,
          },
        ]
      : [
          {
            type: "button",
            text: { type: "plain_text", text: claimed_by_slack_id ? "↩️ Unclaim" : "🙋 Claim" },
            action_id: "claim_ticket",
            value: msg_ts,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Mark Resolved" },
            style: "primary",
            action_id: "resolve_from_ticket_channel",
            value: msg_ts,
          },
        ];

  const blocks: Record<string, unknown>[] = [
    { type: "section", text: { type: "mrkdwn", text: statusText } },
    { type: "actions", elements: actionElements },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${displayTitle}*\nby <@${opened_by_slack_id}>` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `>${(description || "").slice(0, 2900).replace(/\n/g, "\n>")}` },
    },
  ];

  if (permalink) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "View in Slack" }, action_id: "view_thread", url: permalink }],
    });
  }

  const numericTicket = Number(ticket_number);
  if (Number.isInteger(numericTicket) && numericTicket > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `Ticket ${numericTicket}` }] });
  }

  return blocks;
}

// Resolve a ticket via Pixorpheus's bot instead of the dashboard's own Slack
// app , the dashboard's bot isn't reliably a member of the help channel (and
// lacks the scope to self-join), so posting the resolved message straight
// from here was silently failing. Pixorpheus's bot already lives in the
// channel and already has a working "Mark resolved" flow, so this just asks
// it to replay that exact flow via its EXTERNAL_API_KEY-guarded API instead
// of duplicating the Slack calls with a weaker token.
async function resolveViaPixorpheus(
  url: string,
  key: string,
  ts: string,
  actor: { slackId: string; username: string },
): Promise<ResolveResult> {
  const res = await fetch(`${url}/${ts}/resolve`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ slackId: actor.slackId, username: actor.username }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.ok) return { ok: true };
  let msg = "";
  try {
    msg = ((await res.json()) as { error?: string }).error ?? "";
  } catch {}
  if (res.status === 400 && /already resolved/i.test(msg)) return { ok: true, alreadyClosed: true };
  if (res.status === 404) return { ok: false, error: "No ticket found for this message." };
  return { ok: false, error: msg || `Pixorpheus resolve failed (${res.status})` };
}

// Resolve a ticket straight from the dashboard. Prefers routing through
// Pixorpheus (see resolveViaPixorpheus) when EXTERNAL_TICKETS_URL +
// EXTERNAL_API_KEY are configured; otherwise falls back to closing the row
// and running the Slack side-effects directly from here, same as before.
export async function resolveTicketFromDash(
  ts: string,
  actor: { slackId: string; username: string },
): Promise<ResolveResult> {
  const extUrl = process.env.EXTERNAL_TICKETS_URL;
  const extKey = process.env.EXTERNAL_API_KEY;
  if (extUrl && extKey) return resolveViaPixorpheus(extUrl, extKey, ts, actor);

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

    if (ticketRow.ticket_msg_ts) {
      try {
        await slackCall("chat.update", {
          channel: process.env.SLACK_TICKET_CHANNEL,
          ts: ticketRow.ticket_msg_ts,
          text: `Ticket resolved by <@${actor.slackId}>`,
          blocks: ticketBlocks(ticketRow),
        });
      } catch (e) {
        console.error(`resolveTicketFromDash: failed to update ticket-channel card for ${ts}:`, e);
      }
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