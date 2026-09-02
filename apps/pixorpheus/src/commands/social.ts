import axios from "axios";
import { app } from "../slack/app.js";
import { PIXL_CHANNELS, PIXL_PROMO } from "../constants.js";
import { aiPost, streamedAICall } from "../ai/client.js";
import { getAIReply } from "../ai/persona.js";
import { checkAiRateLimit, AI_RATE_LIMIT_MESSAGE } from "../ai/rateLimit.js";
import { userMemory, parseFacts } from "../memory/users.js";
import { botStats } from "../stats.js";
import { escapeMrkdwn } from "../slack/escape.js";

app.command("/pixl-joke", async ({ command, ack, respond }) => {
  await ack();
  const promo = PIXL_CHANNELS.includes(command.channel_id) ? "" : PIXL_PROMO;
  try {
    const res = await axios.get("https://v2.jokeapi.dev/joke/Any?blacklistFlags=racist,sexist&type=twopart,single", {
      timeout: 5000,
    });
    const joke = res.data;
    const text = joke.type === "twopart" ? `${joke.setup}\n\n${joke.delivery}` : joke.joke;
    await respond({ text: `${text}${promo}` });
  } catch (err) {
    await respond({ text: "couldn't fetch a joke lol" });
  }
});

app.command("/pixl-roast", async ({ command, ack, client }) => {
  await ack();
  if (!checkAiRateLimit(command.user_id)) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: AI_RATE_LIMIT_MESSAGE,
    });
    return;
  }
  const mention = command.text?.trim();
  const match = mention?.match(/<@([A-Za-z0-9]+)(?:\|[^>]+)?>/);
  const targetId = match?.[1] || command.user_id;

  let nameForAI = "this person";
  try {
    const info = await client.users.info({ user: targetId });
    nameForAI = info.user?.profile?.display_name || info.user?.real_name || info.user?.name || "this person";
  } catch (e) {}

  const memoryFacts = parseFacts(userMemory.get(targetId));
  const memoryHint = memoryFacts?.length ? ` known facts: ${memoryFacts.join(", ")}.` : "";
  botStats.roasts++;
  await getAIReply(
    [
      {
        role: "user",
        content: `write a single brutal, creative, funny roast sentence about "${nameForAI}".${memoryHint} do NOT start with "i don't know", "i've never met", or any disclaimer. just go straight in with the roast. be specific and unhinged.`,
      },
    ],
    null,
    null,
    false,
    null,
    { client, postParams: { channel: command.channel_id }, format: (t) => `<@${targetId}> ${t}` },
  );
});

app.command("/pixl-urban", async ({ command, ack, respond }) => {
  await ack();
  if (!checkAiRateLimit(command.user_id)) {
    await respond({ text: AI_RATE_LIMIT_MESSAGE });
    return;
  }
  const term = command.text?.trim();
  if (!term) {
    await respond({ text: "Usage: `/pixl-urban yolo`" });
    return;
  }
  try {
    const res = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
    const results = (res.data.list || []).slice(0, 5);
    if (!results.length) {
      await respond({ text: `no definition found for "${term}"` });
      return;
    }

    const defsText = results
      .map((d: any, i: number) => {
        const def = d.definition.replace(/\[|\]/g, "").slice(0, 300);
        const ex = d.example ? ` | ex: ${d.example.replace(/\[|\]/g, "").slice(0, 100)}` : "";
        return `${i + 1}. ${def}${ex}`;
      })
      .join("\n");

    const aiRes = await aiPost({
      messages: [
        {
          role: "system",
          content:
            "You are a content filter for a school-age Slack community. Given Urban Dictionary definitions for a term, pick the most appropriate one (least sexual/explicit/offensive/racist) and return ONLY that definition text, max 300 characters, no intro. If every single definition is sexual, explicitly NSFW, racist, or grossly offensive, reply with only the word: TOO_SPICY",
        },
        { role: "user", content: `Term: "${term}"\n\n${defsText}` },
      ],
      max_tokens: 150,
    });

    const picked = aiRes.data.choices?.[0]?.message?.content?.trim();
    if (!picked || picked.toUpperCase() === "TOO_SPICY") {
      await respond({ text: `too spicy for this server ngl` });
    } else {
      await respond({ text: `*${escapeMrkdwn(term)}*\n${escapeMrkdwn(picked)}` });
    }
  } catch (e) {
    await respond({ text: "Urban Dictionary is being dumb, try again." });
  }
});

// /pixl-fact - random interesting fact
app.command("/pixl-fact", async ({ command, ack, client }) => {
  await ack();
  if (!checkAiRateLimit(command.user_id)) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: AI_RATE_LIMIT_MESSAGE,
    });
    return;
  }
  try {
    const stream = await streamedAICall(
      client,
      { channel: command.channel_id },
      {
        messages: [
          {
            role: "system",
            content: 'Give one genuinely surprising or weird fact. 1 sentence, lowercase, no intro like "did you know". Just the fact.',
          },
          { role: "user", content: "give me a fact" },
        ],
        max_tokens: 80,
      },
      { format: (t) => ` ${t}` },
    );
    const fact = stream.rawContent.trim() || "facts are hard";
    await stream.finalize(` ${fact}`);
  } catch (e) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "failed",
    });
  }
});
