import type { WebClient } from "@slack/web-api";
import { db } from "../db/client.js";
import { aiPost } from "../ai/client.js";
import { answerQuestion } from "../ai/answerFromDocs.js";
import { DOCS_LINKS } from "../ai/docs.js";
import { checkAiRateLimit } from "../ai/rateLimit.js";
import { app } from "../slack/app.js";
import { normalizeTicket } from "./repo.js";
import { ticketBlocks } from "./blocks.js";
import {
  pendingTickets,
  titlePrompts,
  creatingTickets,
  processedHelpMsgs,
  ticketChannelMembership,
  MEMBERSHIP_TTL_MS,
  type PendingTicketEvent,
} from "./state.js";

export async function checkFAQAndSimilar(event: PendingTicketEvent, client: WebClient): Promise<void> {
  const question = event.text || "";
  if (question.length < 15) return;
  // Nothing else gated this AI call — spamming ticket creation was an
  // unthrottled way to burn through the shared OpenRouter credit budget.
  if (!checkAiRateLimit(event.user)) return;

  let rows: { description: string; permalink: string | null; title: string | null }[] = [];
  try {
    const result = await db()
      .from("tickets")
      .select("description, permalink, title")
      .eq("status", "closed")
      .not("description", "is", null)
      .neq("description", "[no text - see thread for attachments]")
      .order("closed_at", { ascending: false })
      .limit(60);
    rows = result.data || [];
  } catch (e) {
    return;
  }
  if (!rows.length) return;

  try {
    const ticketList = rows
      .map((t, i) => {
        const label = t.title || t.description.slice(0, 100);
        return `${i + 1}. ${label}`;
      })
      .join("\n");

    const res = await aiPost({
      messages: [
        {
          role: "system",
          content:
            "You help match support questions to previously resolved tickets. If the new question is clearly similar to one of the listed past tickets, reply with only that ticket's number. If none match well enough, reply with NONE. Be strict — only match if it's genuinely the same problem.",
        },
        {
          role: "user",
          content: `New question: "${question}"\n\nPast resolved tickets:\n${ticketList}`,
        },
      ],
      max_tokens: 5,
    });

    const answer = res.data.choices?.[0]?.message?.content?.trim();
    const idx = parseInt(answer || "") - 1;
    if (isNaN(idx) || idx < 0 || idx >= rows.length) return;

    const match = rows[idx];
    const label = match.title || match.description.slice(0, 80);
    const linkPart = match.permalink
      ? ` Check <${match.permalink}|this similar resolved question> - it might answer yours.`
      : "";

    await client.chat.postEphemeral({
      channel: event.channel,
      user: event.user,
      text: `We found a similar resolved question that might help!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:mag: We found a similar question that was already resolved:\n*${label}*${linkPart}\n\nIf this doesn't answer your question, your ticket will still be created - a helper will follow up soon.`,
          },
        },
        ...(process.env.SLACK_FAQ_URL
          ? [
              {
                type: "actions" as const,
                elements: [
                  {
                    type: "button" as const,
                    text: { type: "plain_text" as const, text: "View FAQ" },
                    url: process.env.SLACK_FAQ_URL,
                    action_id: "view_faq",
                  },
                ],
              },
            ]
          : []),
      ],
    });
  } catch (e) {}
}

export async function deleteTitlePrompt(
  msgTs: string,
  client: WebClient,
  knownTs: string | null = null,
): Promise<void> {
  const mem = titlePrompts.get(msgTs);
  titlePrompts.delete(msgTs);
  const channel = mem?.channel || process.env.SLACK_HELP_CHANNEL!;
  let ts = knownTs || mem?.ts;
  if (!ts) {
    try {
      const { data } = await db()
        .from("tickets")
        .select("title_prompt_ts")
        .eq("msg_ts", msgTs)
        .maybeSingle();
      ts = data?.title_prompt_ts ? String(data.title_prompt_ts) : undefined;
    } catch (e) {}
  }
  if (!ts) return;
  try {
    await client.chat.delete({ channel, ts });
  } catch (e) {}
  db()
    .from("tickets")
    .update({ title_prompt_ts: null })
    .eq("msg_ts", msgTs)
    .then(
      () => {},
      () => {},
    );
}

export async function createTicket(
  event: PendingTicketEvent,
  title: string | null,
  client: WebClient,
): Promise<void> {
  // Prevent concurrent calls for the same message
  if (creatingTickets.has(event.ts)) return;
  creatingTickets.add(event.ts);
  setTimeout(() => creatingTickets.delete(event.ts), 10 * 60 * 1000);

  const pending = pendingTickets.get(event.ts);
  if (pending) {
    clearTimeout(pending.timer);
    pendingTickets.delete(event.ts);
  }

  // Fetch the ticket row that was already created in handleNewQuestion
  let ticketRow;
  try {
    const r = await db().from("tickets").select("*").eq("msg_ts", event.ts).limit(1).maybeSingle();
    ticketRow = normalizeTicket(r.data);
  } catch (e: any) {
    console.error("[createTicket] SELECT error:", e.message);
    creatingTickets.delete(event.ts);
    return;
  }

  if (!ticketRow) {
    // Fallback: ticket wasn't pre-created, insert it now
    const description = event.text || "[no text - see thread for attachments]";
    const r = await db()
      .from("tickets")
      .insert({
        msg_ts: event.ts,
        description,
        status: "open",
        opened_by_slack_id: event.user,
      })
      .select()
      .single();
    ticketRow = normalizeTicket(r.data);
    if (!ticketRow) {
      // Likely a unique violation if another call snuck in (supabase-js reports it
      // via r.error instead of throwing) — try SELECT again
      const retry = await db().from("tickets").select("*").eq("msg_ts", event.ts).limit(1).maybeSingle();
      ticketRow = normalizeTicket(retry.data);
    }
    if (!ticketRow) {
      console.error("[createTicket] could not find or create ticket for", event.ts);
      creatingTickets.delete(event.ts);
      return;
    }
  }

  // If already posted to the ticket channel, only update title if provided
  if (ticketRow.ticket_msg_ts) {
    if (title) {
      try {
        const updates = { title };
        const updated = await db().from("tickets").update(updates).eq("msg_ts", event.ts).select().single();
        await client.chat.update({
          channel: process.env.SLACK_TICKET_CHANNEL!,
          ts: ticketRow.ticket_msg_ts,
          text: `Ticket from <@${event.user}>: ${title}`,
          blocks: ticketBlocks(normalizeTicket(updated.data) || ticketRow),
        });
      } catch (e) {}
    }
    creatingTickets.delete(event.ts);
    return;
  }

  // Get permalink and update title/permalink on the row
  let permalink: string | undefined;
  try {
    const pl = await client.chat.getPermalink({
      channel: event.channel,
      message_ts: event.ts,
    });
    permalink = pl.permalink;
  } catch (e) {}

  try {
    const updates: Record<string, unknown> = {};
    if (title) updates.title = title;
    if (permalink) updates.permalink = permalink;
    const updated = await db().from("tickets").update(updates).eq("msg_ts", event.ts).select().single();
    if (updated.data) ticketRow = normalizeTicket(updated.data)!;
  } catch (e) {}

  // Post to ticket channel
  try {
    const ticketMsg = await client.chat.postMessage({
      channel: process.env.SLACK_TICKET_CHANNEL!,
      text: `New ticket from <@${event.user}>${title ? `: ${title}` : ""}`,
      blocks: ticketBlocks(ticketRow),
    });
    await db().from("tickets").update({ ticket_msg_ts: ticketMsg.ts }).eq("msg_ts", event.ts);
  } catch (e: any) {
    console.error("[createTicket] post error:", e.message);
  }

  creatingTickets.delete(event.ts);
}

export async function handleNewQuestion(event: PendingTicketEvent, client: WebClient): Promise<void> {
  if (processedHelpMsgs.has(event.ts)) return;
  processedHelpMsgs.add(event.ts);
  setTimeout(() => processedHelpMsgs.delete(event.ts), 10 * 60 * 1000);

  // Timed so a slow ticket reply can actually be diagnosed from the logs
  // next time — is it our own code, or Slack's API round-trip?
  const startedAt = Date.now();

  // The classic reply people are watching for goes out first, before any
  // DB/reaction round-trips. pixo's docs answer is posted as a SEPARATE
  // follow-up message afterwards (see the end of this function).
  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: "Someone will be here to help you soon!",
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Someone will be here to help you soon! In the meantime, check out the <${process.env.SLACK_FAQ_URL}|FAQ>.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Mark as resolved" },
            style: "primary",
            action_id: "mark_resolved",
            value: event.ts,
          },
        ],
      },
    ],
  });
  console.log(`[handleNewQuestion] reply posted in ${Date.now() - startedAt}ms`);

  // Fire-and-forget from here — nothing downstream needs these to have
  // landed before we move on. createTicket() already falls back to
  // inserting the ticket row itself if this hasn't finished yet.
  db()
    .from("tickets")
    .insert({
      msg_ts: event.ts,
      description: event.text || "[no text]",
      status: "open",
      opened_by_slack_id: event.user,
    })
    .then(
      () => {},
      (e: any) => {
        // Unique violation = already exists from a previous call, that's fine
        if (!e.message?.includes("unique") && !e.message?.includes("duplicate")) {
          console.error("[handleNewQuestion] ticket insert error:", e.message);
        }
      },
    );

  client.reactions
    .add({
      channel: event.channel,
      name: "thinking_face",
      timestamp: event.ts,
    })
    .catch(() => {});

  // Posted as a real thread message (not ephemeral) so it can be deleted later —
  // Slack offers no API to delete an ephemeral after the fact (e.g. on resolve).
  try {
    const prompt = await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `<@${event.user}> give your ticket a title to help the support team!`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<@${event.user}> give your ticket a short title so helpers can triage it faster :)`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Set title" },
              action_id: "open_title_modal",
              value: event.ts,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Skip" },
              action_id: "skip_title",
              value: event.ts,
            },
          ],
        },
      ],
    });
    // Remember the prompt so it can be deleted on set/skip/resolve. DB write is
    // best-effort (column added in migration 0044); the in-memory map covers the
    // common case even if the column is missing.
    titlePrompts.set(event.ts, { channel: event.channel, ts: prompt.ts! });
    db()
      .from("tickets")
      .update({ title_prompt_ts: prompt.ts })
      .eq("msg_ts", event.ts)
      .then(
        () => {},
        () => {},
      );
  } catch (e) {}

  const timer = setTimeout(() => {
    createTicket(event, null, app.client);
  }, 3 * 60 * 1000);

  pendingTickets.set(event.ts, { event, timer });

  // Docs-aware follow-up: a SEPARATE message from pixo, posted after the classic
  // "someone will help you soon" reply above. If the docs answer the question,
  // pixo posts that answer; otherwise it says to wait for a human helper (and
  // offers a similar previously-resolved ticket if there is one).
  try {
    const ans = await answerQuestion(event.text || "");
    if (ans) {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: ans.answer,
        unfurl_links: false,
        unfurl_media: false,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${ans.answer}\n\n_straight from the <${DOCS_LINKS.docs}|docs> - if that doesn't cover it, a helper will still follow up :hii:_`,
            },
          },
        ],
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.ts,
        text: "the docs don't cover this one - just wait for a helper to respond to this one :D",
      });
      checkFAQAndSimilar(event, client).catch(() => {});
    }
  } catch (e) {
    /* the classic reply already went out; nothing more to say on failure */
  }
}

export async function handleMessageInThread(event: PendingTicketEvent & { thread_ts?: string }, client: WebClient): Promise<void> {
  const { data: rawTicket } = await db().from("tickets").select("*").eq("msg_ts", event.thread_ts).maybeSingle();
  const ticket = normalizeTicket(rawTicket);
  if (!ticket) return;

  const isHelper = await checkIsHelper(event.user);
  const text = event.text || "";
  const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase();

  if (isHelper && firstWord?.startsWith("?")) {
    await runMacro(firstWord.slice(1), ticket, event, client);
    return;
  }

  await db().from("tickets").update({ last_msg_at: new Date().toISOString() }).eq("msg_ts", event.thread_ts);
}

export async function checkIsHelper(slackUserId: string): Promise<boolean> {
  const admins = (process.env.SLACK_ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.includes(slackUserId)) return true;
  const { data } = await db().from("helpers").select("slack_user_id").eq("slack_user_id", slackUserId).maybeSingle();
  return !!data;
}

export async function checkIsInTicketChannel(slackUserId: string, client: WebClient): Promise<boolean> {
  const cached = ticketChannelMembership.get(slackUserId);
  if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.ok;
  try {
    let cursor: string | undefined;
    let ok = false;
    do {
      const result = await client.conversations.members({
        channel: process.env.SLACK_TICKET_CHANNEL!,
        limit: 200,
        cursor,
      });
      if (result.members?.includes(slackUserId)) {
        ok = true;
        break;
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    ticketChannelMembership.set(slackUserId, { ok, at: Date.now() });
    return ok;
  } catch (e) {
    return false;
  }
}

export function ticketResultText(result: string): string | null {
  if (result === "already_closed") return "this ticket is already resolved";
  if (result === "already_open") return "this ticket is already open";
  if (result === "not_found") return "couldn't find this ticket";
  return null;
}

export async function notifyIfNotOk(
  result: string,
  ticket: { msg_ts: string },
  event: PendingTicketEvent,
  client: WebClient,
): Promise<void> {
  const text = ticketResultText(result);
  if (!text) return;
  try {
    await client.chat.postEphemeral({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      user: event.user,
      text,
    });
  } catch (e) {}
}

const macros: Record<
  string,
  (ticket: { msg_ts: string }, event: PendingTicketEvent, client: WebClient) => Promise<void>
> = {
  resolve: async (ticket, event, client) => {
    const result = await resolveTicket(ticket.msg_ts, event.user, client);
    await notifyIfNotOk(result, ticket, event, client);
  },
  close: async (ticket, event, client) => {
    const result = await resolveTicket(ticket.msg_ts, event.user, client);
    await notifyIfNotOk(result, ticket, event, client);
  },
  faq: async (ticket, event, client) => {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      text: `Hey! Check out the FAQ here: <${process.env.SLACK_FAQ_URL}|FAQ>`,
    });
    const result = await resolveTicket(ticket.msg_ts, event.user, client);
    await notifyIfNotOk(result, ticket, event, client);
  },
  reopen: async (ticket, event, client) => {
    const result = await reopenTicket(ticket.msg_ts, event.user, client);
    await notifyIfNotOk(result, ticket, event, client);
  },
};

export async function runMacro(
  name: string,
  ticket: { msg_ts: string },
  event: PendingTicketEvent,
  client: WebClient,
): Promise<void> {
  if (macros[name]) {
    await macros[name](ticket, event, client);
    try {
      await client.chat.delete({
        channel: event.channel,
        ts: event.ts,
        token: process.env.SLACK_USER_TOKEN as string,
      } as any);
    } catch (e) {}
  } else {
    await client.chat.postEphemeral({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      user: event.user,
      text: `\`?${name}\` is not a valid macro. Available: \`?resolve\`, \`?faq\`, \`?reopen\``,
    });
  }
}

export async function resolveTicket(msgTs: string, resolverSlackId: string, client: WebClient): Promise<string> {
  // Conditional update (status = "open" in the WHERE, not just a prior
  // SELECT) so two concurrent resolves on the same ticket can't both pass a
  // check-then-act race and both fire off the closing side effects below —
  // only the call that actually flips the row wins.
  const { data: won } = await db()
    .from("tickets")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by_slack_id: resolverSlackId,
    })
    .eq("msg_ts", msgTs)
    .eq("status", "open")
    .select("msg_ts");

  if (!won || won.length === 0) {
    const { data: check } = await db().from("tickets").select("status").eq("msg_ts", msgTs).maybeSingle();
    if (!check) return "not_found";
    return "already_closed";
  }

  await client.chat.postMessage({
    channel: process.env.SLACK_HELP_CHANNEL!,
    thread_ts: msgTs,
    text: `Ticket resolved by <@${resolverSlackId}>!`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Resolved by <@${resolverSlackId}>! If you have more questions, feel free to open a new thread.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "reopen_ticket",
            text: { type: "plain_text", text: "Reopen" },
            value: msgTs,
          },
        ],
      },
    ],
  });

  const { data: rawTicketRow } = await db().from("tickets").select("*").eq("msg_ts", msgTs).maybeSingle();
  const ticketRow = normalizeTicket(rawTicketRow);
  if (ticketRow?.ticket_msg_ts) {
    try {
      await client.chat.update({
        channel: process.env.SLACK_TICKET_CHANNEL!,
        ts: ticketRow.ticket_msg_ts,
        text: `Ticket resolved by <@${resolverSlackId}>`,
        blocks: ticketBlocks(ticketRow),
      });
    } catch (e) {}
  }

  try {
    await client.reactions.add({
      channel: process.env.SLACK_HELP_CHANNEL!,
      name: "white_check_mark",
      timestamp: msgTs,
    });
  } catch (e) {}

  try {
    await client.reactions.remove({
      channel: process.env.SLACK_HELP_CHANNEL!,
      name: "thinking_face",
      timestamp: msgTs,
    });
  } catch (e) {}

  // Clean up the "set a title" prompt if it's still sitting in the thread
  await deleteTitlePrompt(msgTs, client, ticketRow?.title_prompt_ts ?? null);

  return "ok";
}

export async function reopenTicket(msgTs: string, reopenerSlackId: string, client: WebClient): Promise<string> {
  // Same conditional-update pattern as resolveTicket — only the caller that
  // actually flips status "closed" -> "open" proceeds.
  const { data: won } = await db()
    .from("tickets")
    .update({ status: "open", closed_at: null, closed_by_slack_id: null })
    .eq("msg_ts", msgTs)
    .eq("status", "closed")
    .select("msg_ts");

  if (!won || won.length === 0) {
    const { data: check } = await db().from("tickets").select("status").eq("msg_ts", msgTs).maybeSingle();
    if (!check) return "not_found";
    return "already_open";
  }

  await client.chat.postMessage({
    channel: process.env.SLACK_HELP_CHANNEL!,
    thread_ts: msgTs,
    text: `Ticket reopened by <@${reopenerSlackId}>.`,
  });

  const { data: rawTicketRow } = await db().from("tickets").select("*").eq("msg_ts", msgTs).maybeSingle();
  const ticketRow = normalizeTicket(rawTicketRow);
  if (ticketRow?.ticket_msg_ts) {
    try {
      await client.chat.update({
        channel: process.env.SLACK_TICKET_CHANNEL!,
        ts: ticketRow.ticket_msg_ts,
        text: `Ticket reopened by <@${reopenerSlackId}>`,
        blocks: ticketBlocks(ticketRow),
      });
    } catch (e) {}
  }

  try {
    await client.reactions.add({
      channel: process.env.SLACK_HELP_CHANNEL!,
      name: "thinking_face",
      timestamp: msgTs,
    });
  } catch (e) {}

  try {
    await client.reactions.remove({
      channel: process.env.SLACK_HELP_CHANNEL!,
      name: "white_check_mark",
      timestamp: msgTs,
    });
  } catch (e) {}

  return "ok";
}

// The title prompt is now a public thread message — only the ticket author
// should act on it.
export async function isTicketAuthor(msgTs: string, userId: string): Promise<boolean> {
  const pending = pendingTickets.get(msgTs);
  if (pending?.event?.user) return pending.event.user === userId;
  try {
    const { data } = await db().from("tickets").select("opened_by_slack_id").eq("msg_ts", msgTs).maybeSingle();
    return data?.opened_by_slack_id === userId;
  } catch (e) {
    return false;
  }
}

export async function autoCloseOldTickets(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 5 * 86400_000);
    const { data: openTickets } = await db().from("tickets").select("*").eq("status", "open");
    const result = (openTickets || [])
      .map(normalizeTicket)
      .filter((t): t is NonNullable<typeof t> => {
        if (!t) return false;
        const msgDate = new Date(parseFloat(t.msg_ts) * 1000);
        const lastDate = t.last_msg_at ? new Date(t.last_msg_at) : msgDate;
        return msgDate < cutoff && lastDate < cutoff;
      });

    for (const ticket of result) {
      try {
        await app.client.chat.postMessage({
          channel: process.env.SLACK_HELP_CHANNEL!,
          thread_ts: ticket.msg_ts,
          text: "This ticket has been open for 5 days with no activity and is now automatically closed. If you still need help, just post a new message in this channel with the same question and a helper will get back to you.",
        });

        await db()
          .from("tickets")
          .update({ status: "closed", closed_at: new Date().toISOString() })
          .eq("msg_ts", ticket.msg_ts);

        const updatedTicket = { ...ticket, status: "closed" as const };
        if (ticket.ticket_msg_ts) {
          try {
            await app.client.chat.update({
              channel: process.env.SLACK_TICKET_CHANNEL!,
              ts: ticket.ticket_msg_ts,
              text: "Ticket auto-closed after 5 days of inactivity",
              blocks: ticketBlocks(updatedTicket),
            });
          } catch (e) {}
        }

        try {
          await app.client.reactions.add({
            channel: process.env.SLACK_HELP_CHANNEL!,
            name: "white_check_mark",
            timestamp: ticket.msg_ts,
          });
        } catch (e) {}
        try {
          await app.client.reactions.remove({
            channel: process.env.SLACK_HELP_CHANNEL!,
            name: "thinking_face",
            timestamp: ticket.msg_ts,
          });
        } catch (e) {}
        await deleteTitlePrompt(ticket.msg_ts, app.client, ticket.title_prompt_ts);
      } catch (e: any) {
        console.error("[autoClose] ticket error:", e.message);
      }
    }
    if (result.length) console.log(`[autoClose] closed ${result.length} stale ticket(s)`);
  } catch (e: any) {
    console.error("[autoClose]", e.message);
  }
}
