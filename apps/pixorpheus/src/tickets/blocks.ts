import type { KnownBlock } from "@slack/types";
import type { TicketRow } from "./types.js";
import { escapeMrkdwn } from "../slack/escape.js";

export function ticketBlocks(ticket: TicketRow): KnownBlock[] {
  const {
    description,
    title,
    opened_by_slack_id,
    status,
    claimed_by_slack_id,
    closed_by_slack_id,
    ticket_number,
    permalink,
  } = ticket;
  // Slack requires button `value` to be a string; DB may hand back msg_ts as a number.
  const msg_ts = ticket.msg_ts == null ? "" : String(ticket.msg_ts);
  const rawDescription = description || "";
  const safeDescription = escapeMrkdwn(rawDescription);
  const truncatedDescription = rawDescription.length > 80 ? rawDescription.substring(0, 80) + "..." : rawDescription;
  const displayTitle = escapeMrkdwn(title || truncatedDescription || "(no description)");

  let statusText: string;
  if (status === "closed")
    statusText = closed_by_slack_id ? `✅ Resolved by <@${closed_by_slack_id}>` : "✅ Resolved";
  else if (claimed_by_slack_id) statusText = `🟡 Claimed by <@${claimed_by_slack_id}>`;
  else statusText = "🔴 Open - not claimed";

  const actionElements =
    status === "closed"
      ? [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "Reopen" },
            action_id: "reopen_ticket",
            value: msg_ts,
          },
        ]
      : [
          {
            type: "button" as const,
            text: {
              type: "plain_text" as const,
              text: claimed_by_slack_id ? "↩️ Unclaim" : "🙋 Claim",
            },
            action_id: "claim_ticket",
            value: msg_ts,
          },
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "Mark Resolved" },
            style: "primary" as const,
            action_id: "resolve_from_ticket_channel",
            value: msg_ts,
          },
        ];

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: statusText },
    },
    {
      type: "actions",
      elements: actionElements,
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${displayTitle}*\nby <@${opened_by_slack_id}>`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `>${safeDescription.slice(0, 2900).replace(/\n/g, "\n>")}`,
      },
    },
  ];

  if (permalink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Slack" },
          action_id: "view_thread",
          url: permalink,
        },
      ],
    });
  }

  const numericTicket = Number(ticket_number);
  if (Number.isInteger(numericTicket) && numericTicket > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Ticket ${numericTicket}` }],
    });
  }

  return blocks;
}
