import { app } from "../slack/app.js";
import { db, tsStr } from "../db/client.js";
import { escapeMrkdwn } from "../slack/escape.js";

const EMOJI_NAMES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

export function schedulePollClose(
  channel: string,
  messageTs: string,
  question: string,
  options: string[],
  pollId: number | string | null,
  delay: number,
): void {
  setTimeout(async () => {
    try {
      const info = await app.client.reactions.get({
        channel,
        timestamp: messageTs,
      });
      const reactions = (info.message as any)?.reactions || [];
      const results = options.map((opt, i) => {
        const r = reactions.find((r: any) => r.name === EMOJI_NAMES[i]);
        return { opt, count: r ? r.count - 1 : 0 };
      });
      results.sort((a, b) => b.count - a.count);
      const winner = results[0];
      const lines = options.map((opt, i) => {
        const r = reactions.find((r: any) => r.name === EMOJI_NAMES[i]);
        const count = r ? r.count - 1 : 0;
        return `${EMOJIS[i]} ${escapeMrkdwn(opt)} - *${count}* vote${count !== 1 ? "s" : ""}`;
      });
      await app.client.chat.postMessage({
        channel,
        text: `*📊 Poll closed: ${escapeMrkdwn(question)}*\n${lines.join("\n")}\n\n🏆 *${escapeMrkdwn(winner.opt)}* wins with ${winner.count} vote${winner.count !== 1 ? "s" : ""}!`,
      });
      if (pollId != null) await db().from("polls").delete().eq("id", pollId);
    } catch (e: any) {
      console.error("poll close error:", e.message);
    }
  }, delay);
}

export async function loadPendingPolls(): Promise<void> {
  try {
    const { data: pollRows } = await db().from("polls").select("*").gt("closes_at", Date.now());
    for (const row of pollRows || []) {
      const delay = Number(row.closes_at) - Date.now();
      const options = Array.isArray(row.options) ? row.options : JSON.parse(row.options);
      schedulePollClose(row.channel, tsStr(row.message_ts)!, row.question, options, row.id, delay);
    }
    if ((pollRows || []).length) console.log(`Loaded ${pollRows!.length} pending poll(s).`);
  } catch (e: any) {
    console.error("loadPendingPolls error:", e.message);
  }
}

app.command("/pixl-poll", async ({ command, ack, client }) => {
  await ack();
  const raw = command.text?.trim();
  if (!raw) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Usage: `/pixl-poll Question | Option1, Option2` - add a timer at the end: `Option1, Option2, 10min`",
    });
    return;
  }

  const sepIdx = raw.indexOf(";");
  if (sepIdx === -1) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Separate your question from options with `;`. Ex: `/pixl-poll Pizza or tacos?; Pizza, Tacos`",
    });
    return;
  }

  const question = raw.slice(0, sepIdx).trim();
  const options = raw
    .slice(sepIdx + 1)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const timeRegex = /^(\d+)(min|h|d)$/i;
  let durationMs: number | null = null;
  let durationLabel: string | null = null;
  if (options.length && timeRegex.test(options[options.length - 1])) {
    const match = options.pop()!.match(timeRegex)!;
    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    durationMs = unit === "min" ? amount * 60000 : unit === "h" ? amount * 3600000 : amount * 86400000;
    durationLabel = `${amount}${unit}`;
  }

  if (options.length < 2) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Need at least 2 options. Ex: `/pixl-poll Pizza or tacos? | Pizza, Tacos`",
    });
    return;
  }

  const body = options.map((o, i) => `${EMOJIS[i]} ${escapeMrkdwn(o)}`).join("\n");
  const timerNote = durationLabel ? ` - closes in ${durationLabel}` : "";

  const msg = await client.chat.postMessage({
    channel: command.channel_id,
    text: `*📊 ${escapeMrkdwn(question)}*\n${body}\n_poll by <@${command.user_id}>${timerNote}_`,
  });

  for (let i = 0; i < Math.min(options.length, 9); i++) {
    try {
      await client.reactions.add({
        channel: command.channel_id,
        name: EMOJI_NAMES[i],
        timestamp: msg.ts!,
      });
    } catch (_) {}
  }

  if (durationMs) {
    const closesAt = Date.now() + durationMs;
    const { data, error } = await db()
      .from("polls")
      .insert({
        channel: command.channel_id,
        message_ts: msg.ts,
        question,
        options,
        closes_at: closesAt,
      })
      .select("id")
      .single();
    if (error) console.error("[pixl-poll] insert error:", error.message);
    schedulePollClose(command.channel_id, msg.ts!, question, options, data?.id ?? null, durationMs);
  }
});
