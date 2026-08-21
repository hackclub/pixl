import { app } from "../slack/app.js";
import { db } from "../db/client.js";
import { normalizeTicket } from "./repo.js";
import { ticketBlocks } from "./blocks.js";
import {
  checkIsHelper,
  checkIsInTicketChannel,
  resolveTicket,
  reopenTicket,
  ticketResultText,
  isTicketAuthor,
  deleteTitlePrompt,
  createTicket,
} from "./service.js";
import { pendingTickets } from "./state.js";

app.action("mark_resolved", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  const resolver = b.user.id;
  const channelId = b.channel.id;

  let ticket;
  try {
    const { data } = await db().from("tickets").select("opened_by_slack_id").eq("msg_ts", msgTs).maybeSingle();
    ticket = data;
  } catch (e) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: resolver,
      text: "Database error - could not load the ticket.",
    });
    return;
  }

  if (!ticket) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: resolver,
      text: "No ticket found for this message.",
    });
    return;
  }

  const isHelper = await checkIsHelper(resolver);
  const isAuthor = ticket.opened_by_slack_id === resolver;
  const isInTicketChannel = await checkIsInTicketChannel(resolver, client);

  if (!isHelper && !isAuthor && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: resolver,
      text: "Only the ticket author, a helper, or a support team member can mark this as resolved.",
    });
    return;
  }

  const result = await resolveTicket(msgTs, resolver, client);
  const resultText = ticketResultText(result);
  if (resultText) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: resolver,
      text: resultText,
    });
  }
});

app.action("resolve_from_ticket_channel", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  const resolver = b.user.id;
  const channelId = b.channel.id;

  const isInTicketChannel = await checkIsInTicketChannel(resolver, client);
  const isHelper = await checkIsHelper(resolver);

  if (!isHelper && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: resolver,
      text: "Only support team members can resolve tickets from here.",
    });
    return;
  }

  const result = await resolveTicket(msgTs, resolver, client);
  const resultText = ticketResultText(result);
  if (resultText) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: resolver,
      text: resultText,
    });
  }
});

app.action("reopen_ticket", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  const reopener = b.user.id;
  const channelId = b.channel.id;

  let ticket;
  try {
    const { data } = await db().from("tickets").select("opened_by_slack_id").eq("msg_ts", msgTs).maybeSingle();
    ticket = data;
  } catch (e) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: reopener,
      text: "Database error - could not load the ticket.",
    });
    return;
  }

  if (!ticket) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: reopener,
      text: "No ticket found for this message.",
    });
    return;
  }

  const isHelper = await checkIsHelper(reopener);
  const isAuthor = ticket.opened_by_slack_id === reopener;
  const isInTicketChannel = await checkIsInTicketChannel(reopener, client);

  if (!isHelper && !isAuthor && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: reopener,
      text: "Only the ticket author, a helper, or a support team member can reopen tickets.",
    });
    return;
  }

  const result = await reopenTicket(msgTs, reopener, client);
  const resultText = ticketResultText(result);
  if (resultText) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: reopener,
      text: resultText,
    });
  }
});

app.action("view_thread", async ({ ack }) => {
  await ack();
});
app.action("view_faq", async ({ ack }) => {
  await ack();
});

app.action("claim_ticket", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  const claimerId = b.user.id;
  const channelId = b.channel.id;

  const isHelper = await checkIsHelper(claimerId);
  const isInTicketChannel = await checkIsInTicketChannel(claimerId, client);

  if (!isHelper && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: claimerId,
      text: "Only support team members can claim tickets.",
    });
    return;
  }

  let ticketRow;
  try {
    const { data } = await db().from("tickets").select("*").eq("msg_ts", msgTs).maybeSingle();
    ticketRow = normalizeTicket(data);
  } catch (e) {
    return;
  }
  if (!ticketRow || ticketRow.status === "closed") return;

  const newClaimedBy = ticketRow.claimed_by_slack_id === claimerId ? null : claimerId;
  await db().from("tickets").update({ claimed_by_slack_id: newClaimedBy }).eq("msg_ts", msgTs);

  if (ticketRow.ticket_msg_ts) {
    try {
      await client.chat.update({
        channel: process.env.SLACK_TICKET_CHANNEL!,
        ts: ticketRow.ticket_msg_ts,
        text: newClaimedBy ? `Claimed by <@${newClaimedBy}>` : "Ticket unclaimed",
        blocks: ticketBlocks({
          ...ticketRow,
          claimed_by_slack_id: newClaimedBy,
        }),
      });
    } catch (e) {}
  }
});

app.action("skip_title", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  if (!(await isTicketAuthor(msgTs, b.user.id))) {
    try {
      await client.chat.postEphemeral({
        channel: b.channel.id,
        thread_ts: msgTs,
        user: b.user.id,
        text: "Only the ticket author can set or skip the title.",
      });
    } catch (e) {}
    return;
  }
  await deleteTitlePrompt(msgTs, client, b.message?.ts);
  const pending = pendingTickets.get(msgTs);
  if (!pending) return;
  await createTicket(pending.event, null, app.client);
});

app.action("open_title_modal", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const msgTs = b.actions[0].value;
  if (!(await isTicketAuthor(msgTs, b.user.id))) {
    try {
      await client.chat.postEphemeral({
        channel: b.channel.id,
        thread_ts: msgTs,
        user: b.user.id,
        text: "Only the ticket author can set or skip the title.",
      });
    } catch (e) {}
    return;
  }
  try {
    await client.views.open({
      trigger_id: b.trigger_id,
      view: {
        type: "modal",
        callback_id: "title_modal",
        private_metadata: JSON.stringify({
          msgTs,
          promptTs: b.message?.ts || null,
        }),
        notify_on_close: true,
        title: { type: "plain_text", text: "Set ticket title" },
        submit: { type: "plain_text", text: "Set title" },
        close: { type: "plain_text", text: "Skip" },
        blocks: [
          {
            type: "input",
            block_id: "title_block",
            label: { type: "plain_text", text: "Title" },
            element: {
              type: "plain_text_input",
              action_id: "title_input",
              placeholder: {
                type: "plain_text",
                text: 'e.g. "Can\'t access my Pixl account"',
              },
              max_length: 100,
            },
          },
        ],
      },
    });
  } catch (e: any) {
    console.error("[open_title_modal]", e.message);
  }
});
