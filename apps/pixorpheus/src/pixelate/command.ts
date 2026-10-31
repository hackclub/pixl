import { pixelateAvatar } from "./image.js";
import { app } from "../slack/app.js";
import { PIXL_CHANNELS } from "../constants.js";
import { botStats } from "../stats.js";

app.command("/pixl", async ({ command, ack, client }) => {
  await ack();

  if (!PIXL_CHANNELS.includes(command.channel_id)) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `This command is only available in <#C0B5P4N0WHH>. Join it to use it!`,
    });
    return;
  }

  const args = command.text?.trim() || "";
  // parse optional pixel size at the end: "/pixl @user 16" or "/pixl 16"
  const sizeMatch = args.match(/\b(\d+)\s*$/);
  const pixelSize = sizeMatch ? Math.min(64, Math.max(2, parseInt(sizeMatch[1]))) : 8;
  const mentionPart = sizeMatch ? args.slice(0, sizeMatch.index).trim() : args;
  const mention = mentionPart || null;
  let targetId = command.user_id;

  if (mention) {
    const fromMention = mention.match(/<@([A-Za-z0-9]+)/)?.[1];
    if (fromMention) {
      targetId = fromMention;
    } else {
      const username = mention.replace(/^@/, "").toLowerCase();
      let found;
      let cursor: string | undefined;
      try {
        do {
          const page = await client.users.list({ limit: 200, cursor });
          found = page.members?.find(
            (m) => m.name?.toLowerCase() === username || m.profile?.display_name?.toLowerCase() === username,
          );
          cursor = found ? undefined : page.response_metadata?.next_cursor;
        } while (!found && cursor);
      } catch (e: any) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: `User lookup failed: ${e.message}`,
        });
        return;
      }
      if (!found) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: `User "${mention}" not found. Try selecting from the @mention dropdown.`,
        });
        return;
      }
      targetId = found.id!;
    }
  }

  try {
    const result = await client.users.info({ user: targetId });
    const avatarUrl =
      result.user?.profile?.image_512 || result.user?.profile?.image_192 || result.user?.profile?.image_72;

    if (!avatarUrl) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "No profile picture found.",
      });
      return;
    }

    const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Could not download profile picture");
    const buffer = await pixelateAvatar(Buffer.from(await response.arrayBuffer()), pixelSize);

    const uploadResult = await client.files.uploadV2({
      channel_id: command.channel_id,
      file: buffer,
      filename: `pixl-${targetId}.png`,
      initial_comment: `<@${targetId}> pixelated at ${pixelSize}px blocks (${Math.round((1 - 1 / (pixelSize * pixelSize)) * 100)}% pixelated)`,
    });

    const fileId = (uploadResult as any)?.files?.[0]?.files?.[0]?.id;
    botStats.pixelizations++;

    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Sent!",
      blocks: fileId
        ? [
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Delete it" },
                  style: "danger",
                  action_id: "delete_pixl",
                  value: fileId,
                },
              ],
            },
          ]
        : undefined,
    });
  } catch (e: any) {
    const detail = e.data?.needed ? `missing scope: ${e.data.needed}` : e.message;
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `Failed: ${detail}`,
    });
  }
});

app.action("delete_pixl", async ({ ack, body, client }) => {
  await ack();
  const b = body as any;
  const fileId = b.actions[0].value;
  const channelId = b.channel.id;

  let msgTs: string | undefined;
  try {
    const info = await client.files.info({ file: fileId });
    const shares = (info.file as any)?.shares?.public?.[channelId] || (info.file as any)?.shares?.private?.[channelId];
    msgTs = shares?.[0]?.ts;
  } catch (_) {}

  try {
    await client.files.delete({ file: fileId });
  } catch (_) {}
  if (msgTs) {
    try {
      await client.chat.delete({ channel: channelId, ts: msgTs });
    } catch (_) {}
  }
});
