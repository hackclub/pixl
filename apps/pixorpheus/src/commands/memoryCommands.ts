import { app } from "../slack/app.js";
import { db } from "../db/client.js";
import { GABIN_ID } from "../constants.js";
import { aiPost } from "../ai/client.js";
import { sanitizeAIOutput } from "../ai/outputFilter.js";
import { checkAiRateLimit, AI_RATE_LIMIT_MESSAGE } from "../ai/rateLimit.js";
import { userMemory, personalityMemory, parseFacts, getDisplayName, GARBAGE_PATTERNS } from "../memory/users.js";
import { programMemory, addProgramFact, removeProgramFact } from "../memory/program.js";
import { checkIsHelper, checkIsInTicketChannel } from "../tickets/service.js";

app.command("/pixl-remember", async ({ command, ack, respond, client }) => {
  await ack();
  const isAdmin = await checkIsHelper(command.user_id);
  const isInTicketChannel = await checkIsInTicketChannel(command.user_id, client);
  if (!isAdmin && !isInTicketChannel && command.user_id !== GABIN_ID) {
    await respond({ text: "Only support team members can add to my memory." });
    return;
  }
  const fact = command.text?.trim();
  if (!fact) {
    await respond({ text: "Usage: `/pixl-remember [fact about this server]`" });
    return;
  }
  await addProgramFact(fact);
  await respond({ text: `got it, i'll remember: _${fact}_` });
});

app.command("/pixl-forget", async ({ command, ack, respond, client }) => {
  await ack();
  const isAdmin = await checkIsHelper(command.user_id);
  const isInTicketChannel = await checkIsInTicketChannel(command.user_id, client);
  if (!isAdmin && !isInTicketChannel) {
    await respond({ text: "Only support team members can modify my memory." });
    return;
  }
  if (!programMemory.length) {
    await respond({ text: "nothing stored to forget lol" });
    return;
  }
  const idx = parseInt(command.text?.trim() || "") - 1;
  if (isNaN(idx) || idx < 0 || idx >= programMemory.length) {
    await respond({
      text: `Usage: \`/pixl-forget [number]\`\n${programMemory.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
    });
    return;
  }
  const removed = programMemory[idx];
  await removeProgramFact(idx);
  await respond({ text: `forgot: _${removed}_` });
});

app.command("/pixl-memories", async ({ command, ack, respond, client }) => {
  await ack();
  const isAdmin = await checkIsHelper(command.user_id);
  const isInTicketChannel = await checkIsInTicketChannel(command.user_id, client);
  if (!isAdmin && !isInTicketChannel) {
    await respond({
      text: "Only support team members can view stored memories.",
    });
    return;
  }
  if (!programMemory.length) {
    await respond({
      text: "nothing stored yet. use `/pixl-remember [fact]` to add some.",
    });
    return;
  }
  await respond({
    text: `*Stored program memories:*\n${programMemory.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
  });
});

// /pixl-mymemory [@user] — shows what pixorpheus remembers about you or someone else
app.command("/pixl-mymemory", async ({ command, ack, respond }) => {
  await ack();
  if (!checkAiRateLimit(command.user_id)) {
    await respond({ text: AI_RATE_LIMIT_MESSAGE, response_type: "ephemeral" });
    return;
  }
  const mentionMatch = command.text?.trim().match(/^<@([A-Z0-9]+)(?:\|[^>]+)?>/);
  const targetId = mentionMatch ? mentionMatch[1] : command.user_id;
  const isSelf = targetId === command.user_id;

  // Memory is harvested from private DMs and can contain sensitive facts —
  // only the subject themself or a helper/admin can look it up.
  if (!isSelf && !(await checkIsHelper(command.user_id))) {
    await respond({ text: "you can only look up your own memory.", response_type: "ephemeral" });
    return;
  }

  const list = parseFacts(userMemory.get(targetId));
  const traitList = parseFacts(personalityMemory.get(targetId));
  const cleanFacts = list.filter((f) => !GARBAGE_PATTERNS.some((p) => p.test(f)));

  const displayName = getDisplayName(targetId) || (isSelf ? "you" : `<@${targetId}>`);

  if (!cleanFacts.length && !traitList.length) {
    await respond({
      text: `i don't remember anything about ${isSelf ? "you" : displayName} yet 💀`,
      response_type: "ephemeral",
    });
    return;
  }

  try {
    const input = [
      cleanFacts.length ? `facts: ${cleanFacts.join(", ")}` : null,
      traitList.length ? `personality: ${traitList.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    // Memory can contain sensitive facts about the subject, so this always
    // goes back through respond() (ephemeral, visible only to the caller) —
    // never posted into the channel, even for the "someone else" case.
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content: isSelf
            ? `You are Pixorpheus, a sarcastic Slack bot. The person asking is the subject — speak DIRECTLY to them using "you". Write 1-2 casual sentences summarizing what you know about them. Lowercase, conversational, gen Z energy. No lists. Only mention real concrete things — skip anything vague.`
            : `You are Pixorpheus, a sarcastic Slack bot. Write 1-2 casual sentences summarizing who ${displayName} is. Use their name or "they". Lowercase, conversational, gen Z energy. No lists. Only mention real concrete things — skip anything vague.`,
        },
        { role: "user", content: input },
      ],
      max_tokens: 120,
    });
    const summary = res.data.choices?.[0]?.message?.content?.trim();
    if (summary) {
      const safeSummary = sanitizeAIOutput(summary);
      await respond({
        text: isSelf ? `here's what i got on you:\n${safeSummary}` : `here's what i know about ${displayName}:\n${safeSummary}`,
        response_type: "ephemeral",
      });
      return;
    }
  } catch (e) {}

  await respond({
    text: isSelf
      ? `here's what i got on you:\n${cleanFacts.join("\n")}`
      : `here's what i know about ${displayName}:\n${cleanFacts.map((f) => `• ${f}`).join("\n")}`,
    response_type: "ephemeral",
  });
});

// /pixl-leaderboard — show who has the most memory facts stored (most active)
app.command("/pixl-leaderboard", async ({ command, ack, client }) => {
  await ack();
  try {
    const { data: rows } = await db().from("user_memory").select("slack_user_id, facts");
    const leaderboard = (rows || [])
      .map((r) => ({
        slack_user_id: r.slack_user_id,
        cnt: Array.isArray(r.facts) ? r.facts.length : r.facts ? JSON.parse(String(r.facts)).length : 0,
      }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 10);
    if (!leaderboard.length) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "no data yet",
      });
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    const lines = leaderboard.map((r, i) => `${medals[i] || `${i + 1}.`} <@${r.slack_user_id}> - ${r.cnt} facts remembered`);
    await client.chat.postMessage({
      channel: command.channel_id,
      text: `*🏆 most known by pixorpheus:*\n${lines.join("\n")}`,
    });
  } catch (e) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "failed",
    });
  }
});
