import axios from "axios";
import { app } from "../slack/app.js";
import { logEvent } from "../slack/logs.js";
import { botStats } from "../stats.js";
import { escapeMrkdwn } from "../slack/escape.js";

app.command("/pixl-ship", async ({ command, ack, client }) => {
  await ack();
  const desc = command.text?.trim();
  if (!desc) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Usage: `/pixl-ship my new portfolio site`",
    });
    return;
  }
  const safeDesc = escapeMrkdwn(desc);
  await client.chat.postMessage({
    channel: command.channel_id,
    text: `🚀 <@${command.user_id}> just shipped: *${safeDesc}* - let's go!!`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🚀 *<@${command.user_id}> just shipped something!*\n\n> ${safeDesc}\n\ngo hype them up 👇`,
        },
      },
    ],
  });
  logEvent(client, `🚀 new ship from <@${command.user_id}>: ${escapeMrkdwn(desc.slice(0, 140))}`);
  botStats.aiReplies++;
});

app.command("/pixl-lastship", async ({ command, ack, client }) => {
  await ack();

  const raw = command.text?.trim() || "";
  const slackMention = raw.match(/^<@([A-Z0-9]+)>/);
  const githubArg = slackMention ? null : raw.replace(/^@/, "") || null;
  const lookupSlackId = slackMention ? slackMention[1] : command.user_id;

  try {
    const res = await axios.get("https://ships.hackclub.com/api/v1/ysws_entries", { timeout: 10000 });
    const all = res.data || [];

    let entries;
    let label;

    if (githubArg) {
      entries = all.filter((e: any) => e.github_username?.toLowerCase() === githubArg.toLowerCase());
      label = githubArg;
    } else {
      entries = all.filter((e: any) => e.slack_id === lookupSlackId);
      label = `<@${lookupSlackId}>`;
    }

    if (!entries.length) {
      const hint = githubArg ? "" : " - or use `/pixl-lastship your_github_username` if your Slack isn't linked";
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `no approved ships found for ${label}${hint}`,
      });
      return;
    }

    entries.sort((a: any, b: any) => b.approved_at - a.approved_at);
    const e = entries[0];

    const lines = [`🚀 *Last ship by ${escapeMrkdwn(String(e.github_username))}* (via <@${command.user_id}>)`];
    if (e.ysws) lines.push(`📦 Program: ${escapeMrkdwn(String(e.ysws))}`);
    if (e.description) lines.push(`> ${escapeMrkdwn(String(e.description))}`);
    if (e.code_url) lines.push(`💻 Code: ${escapeMrkdwn(String(e.code_url))}`);
    if (e.demo_url) lines.push(`🌐 Demo: ${escapeMrkdwn(String(e.demo_url))}`);
    if (e.hours) lines.push(`⏱️ ${e.hours}h spent`);

    await client.chat.postMessage({
      channel: command.channel_id,
      text: lines.join("\n"),
    });
  } catch (err) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "couldn't fetch ships rn",
    });
  }
});
