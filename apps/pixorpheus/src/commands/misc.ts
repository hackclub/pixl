import { app } from "../slack/app.js";
import { PIXL_CHANNELS, PIXL_PROMO } from "../constants.js";
import { botStats } from "../stats.js";
import { escapeMrkdwn } from "../slack/escape.js";

app.command("/pixl-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  const promo = PIXL_CHANNELS.includes(command.channel_id) ? "" : PIXL_PROMO;
  await respond({ text: `Pong! Latency: ${Date.now() - start}ms${promo}` });
});

app.command("/pixl-help", async ({ command, ack, respond }) => {
  await ack();
  const promo = PIXL_CHANNELS.includes(command.channel_id) ? "" : PIXL_PROMO;
  await respond({
    text: `*Pixl Bot Commands*\n
*/pixl [@user]* - Pixelate a user's profile picture
*/pixl-roast [@user]* - Roast someone (or yourself)
*/pixl-urban [word]* - Urban Dictionary definition
*/pixl-remind [time] [message]* - Set a reminder (e.g. /pixl-remind 10min lunch)
*/pixl-countdown [time] [label]* - Countdown timer that posts when it hits zero
*/pixl-ping* - Check bot latency
*/pixl-help* - Show this help message
*/pixl-joke* - Get a random joke
*/pixl-coinflip* - Flip a coin
*/pixl-fact* - Get a random surprising fact
*/pixl-ask [question]* - Ask Pixorpheus anything publicly
*/pixl-poll Question; Option1, Option2 [, 10min]* - Create a poll, add a timer at the end to auto-post results
*/pixl-ship [description]* - Announce a project you shipped
*/pixl-lastship [github_username]* - Show your last ship on Hackclub Ships (or someone else's)
*/pixl-leaderboard* - Who does Pixorpheus know the most about
*/pixl-mymemory [@user]* - See what Pixorpheus remembers about you (or someone else)
*/pixl-stats* - Bot activity stats
*/pixl-helpstats* - Ticket stats
*/pixl-addhelper [@user]* - Add a helper (support team only)
*/pixl-removehelper [@user]* - Remove a helper (support team only)
*/pixl-helpers* - List all helpers
*/pixl-remember [fact]* - Teach Pixorpheus something about this server (support team only)
*/pixl-forget [number]* - Remove a memory entry (support team only)
*/pixl-memories* - List stored program memories (support team only)
_Mention @pixorpheus in any channel or DM the bot to chat with it. Ask it to "summarize this thread" to get a recap!_${promo}`,
  });
});

app.command("/pixl-coinflip", async ({ command, ack, respond }) => {
  await ack();
  const promo = PIXL_CHANNELS.includes(command.channel_id) ? "" : PIXL_PROMO;
  await respond({
    text: `Coin flip: ${Math.random() < 0.5 ? "Heads" : "Tails"}${promo}`,
  });
});

app.command("/pixl-stats", async ({ ack, respond }) => {
  await ack();
  await respond({
    text: `*Pixorpheus Stats* (since last restart)\n• Pixelizations: ${botStats.pixelizations}\n• AI replies: ${botStats.aiReplies}\n• Roasts delivered: ${botStats.roasts}\n• Reminders set: ${botStats.reminders}`,
  });
});

app.command("/pixl-remind", async ({ command, ack, respond, client }) => {
  await ack();
  const match = command.text?.trim().match(/^(\d+)(s|min|h)\s+(.+)$/i);
  if (!match) {
    await respond({ text: "Usage: `/pixl-remind 10min grab lunch`" });
    return;
  }
  const amount = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const msg = match[3];
  const ms = unit === "s" ? amount * 1000 : unit === "min" ? amount * 60000 : amount * 3600000;
  if (ms > 24 * 3600000) {
    await respond({ text: "Max reminder time is 24h." });
    return;
  }
  botStats.reminders++;
  await respond({
    text: `got it, reminding you in ${amount}${unit}: _${escapeMrkdwn(msg)}_`,
  });
  setTimeout(async () => {
    try {
      await client.chat.postMessage({
        channel: command.channel_id,
        text: `<@${command.user_id}> reminder: ${escapeMrkdwn(msg)}`,
      });
    } catch (e) {}
  }, ms);
});

// /pixl-countdown — countdown timer that posts updates
app.command("/pixl-countdown", async ({ command, ack, respond, client }) => {
  await ack();
  const match = command.text?.trim().match(/^(\d+)(s|min|h)\s+(.+)$/i);
  if (!match) {
    await respond({ text: "Usage: `/pixl-countdown 5min launch`" });
    return;
  }
  const amount = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  const label = match[3];
  const ms = unit === "s" ? amount * 1000 : unit === "min" ? amount * 60000 : amount * 3600000;
  if (ms > 24 * 3600000) {
    await respond({ text: "max 24h bestie" });
    return;
  }
  await respond({
    text: `⏳ countdown started: *${escapeMrkdwn(label)}* in ${amount}${unit}`,
  });
  setTimeout(async () => {
    try {
      await client.chat.postMessage({
        channel: command.channel_id,
        text: `⏰ <@${command.user_id}> *${escapeMrkdwn(label)}* - time's up!`,
      });
    } catch (_) {}
  }, ms);
});
