import { app } from "../slack/app.js";
import { checkIsHelper } from "../tickets/service.js";

// React with :pixl-delete: on any Pixo message to delete it, except help
// tickets. Ticket messages (the original question in the help channel, and
// the status card in the private ticket channel) are records the support
// team relies on; letting anyone erase them with a reaction would nuke
// ticket history, so those two channels are exempt.
app.event("reaction_added", async ({ event, client }) => {
  const e = event as any;
  if (e.reaction !== "pixl-delete") return;
  if (e.item.type !== "message") return;
  if (e.item.channel === process.env.SLACK_HELP_CHANNEL || e.item.channel === process.env.SLACK_TICKET_CHANNEL) {
    return;
  }
  // Only the message's own author or a helper/admin can delete it, otherwise
  // anyone could nuke anyone else's messages by reacting.
  const authorId = e.item_user;
  const reactorId = e.user;
  if (authorId !== reactorId && !(await checkIsHelper(reactorId))) {
    return;
  }
  try {
    await client.chat.delete({
      channel: e.item.channel,
      ts: e.item.ts,
    });
  } catch (e2: any) {
    console.error("[pixl-delete] failed to delete message", { channel: e.item.channel, ts: e.item.ts }, e2.data || e2.message);
  }
});
