import { app } from "../slack/app.js";
import { SILENCED_CHANNELS, TRAINING_CHANNEL } from "../constants.js";
import { config, hasLaunched, launchDateLabel } from "../config.generated.js";
import { botIdentity } from "../slack/identity.js";
import { aiPost } from "../ai/client.js";
import { getAIReply } from "../ai/persona.js";
import { streamedAICall, NO_CREDITS } from "../ai/client.js";
import { shouldChimeIn, extractSearchQuery, braveSearch } from "../ai/search.js";
import { extractStyle } from "../memory/style.js";
import { saveStyleMemory } from "../memory/style.js";
import { programMemory } from "../memory/program.js";
import {
  ensureUserName,
  getDisplayName,
  resolveUserMentions,
  extractMemory,
  extractPersonality,
  userMemory,
  parseFacts,
} from "../memory/users.js";
import { botStats } from "../stats.js";
import {
  THREAD_TTL,
  dmHistory,
  threadMemory,
  activeThreads,
  pendingReplies,
  threadHistory,
  mutedThreads,
  lastOrphanThanksAt,
  welcomeThreads,
  maybeUpdateThreadSummary,
  seedThreadHistory,
  seedDMHistory,
} from "./thread.js";

const processedMsgTs = new Set<string>();

let trainingMode = false;
let trainingMessages: string[] = [];

let kawaiiMode = false;
let kawaiiChannel: string | null = null;
let kawaiiMessages: string[] = [];

app.message(async ({ message, client }) => {
  const m = message as any;
  if (SILENCED_CHANNELS.has(m.channel)) return;
  if (m.bot_id && m.bot_id === botIdentity.appId) return;
  if (m.subtype && m.subtype !== "bot_message") return;
  if (m.ts && processedMsgTs.has(m.ts)) return;
  if (m.ts) {
    processedMsgTs.add(m.ts);
    setTimeout(() => processedMsgTs.delete(m.ts), 60000);
  }
  const text = m.text || "";
  if (text.startsWith("##")) return;

  const isDM = m.channel_type === "im";
  // Slack emoji shortcodes like :yay-pixo: or :pix-wave: literally contain
  // "pixo"/"pix" and used to falsely trigger the bot. Strip every :shortcode:
  // before any name-mention check so only the name in actual prose counts.
  const textNoEmoji = text.replace(/:[a-z0-9_'+-]+:/gi, " ");
  const lowerText = textNoEmoji.toLowerCase();
  const mentionsBot =
    lowerText.includes("pixorpheus") ||
    lowerText.includes("pixo") ||
    lowerText.includes(" pix ") ||
    lowerText.startsWith("pix ") ||
    (botIdentity.userId && text.includes(`<@${botIdentity.userId}>`));
  const isPixlQuestion =
    !m.thread_ts &&
    /\b(what'?s|what is|c'est quoi|explain|tell me about|keskon|kézako)\b.{0,40}\bpixl\b|\bpixl\b.{0,40}\b(what|c'est quoi|explain)\b/i.test(
      text,
    );
  const threadKey = m.thread_ts || m.ts;
  const lastActive = m.thread_ts && activeThreads.get(m.thread_ts);
  const inActiveThread = lastActive && Date.now() - lastActive < THREAD_TTL;

  let isBotStartedThread = false;
  if (m.thread_ts && !inActiveThread && !mentionsBot && !isDM) {
    try {
      const parent = await client.conversations.replies({
        channel: m.channel,
        ts: m.thread_ts,
        limit: 1,
      });
      const first = parent.messages?.[0];
      if (first && (first.bot_id === botIdentity.appId || first.user === botIdentity.userId)) isBotStartedThread = true;
    } catch (_) {}
  }

  // Training mode — intercept before the bot mention filter
  if (m.channel === TRAINING_CHANNEL && !m.bot_id) {
    const trimmedLower = text.trim().toLowerCase();
    if (trimmedLower === "pixo:child labor training") {
      trainingMode = true;
      trainingMessages = [];
      await client.chat.postMessage({
        channel: TRAINING_CHANNEL,
        text: "ok i'm watching :eyes: just talk normally, say `pixo:stop child labor training` when you're done and i'll absorb your vibe",
      });
      return;
    }
    if (trimmedLower === "pixo:stop child labor training") {
      trainingMode = false;
      if (trainingMessages.length < 5) {
        await client.chat.postMessage({
          channel: TRAINING_CHANNEL,
          text: "not enough messages to learn from ngl, talk more next time",
        });
        trainingMessages = [];
        return;
      }
      await client.chat.postMessage({
        channel: TRAINING_CHANNEL,
        text: "processing... give me a sec :loading:",
      });
      const style = await extractStyle(trainingMessages);
      if (style) {
        await saveStyleMemory(style);
        await client.chat.postMessage({
          channel: TRAINING_CHANNEL,
          text: `got it, i've absorbed your vibe :brain: i'll talk more like you now\n\n_style notes saved — ${trainingMessages.length} messages analyzed_`,
        });
      } else {
        await client.chat.postMessage({
          channel: TRAINING_CHANNEL,
          text: "something went wrong while learning ur style lol, try again",
        });
      }
      trainingMessages = [];
      return;
    }
    if (trainingMode) {
      const senderName = getDisplayName(m.user) || m.user;
      trainingMessages.push(`${senderName}: ${text}`);
      return;
    }
  }

  // Kawaii stealth mode — works in any channel, silent start
  if (!m.bot_id) {
    const trimmedLower = text.trim().toLowerCase();
    if (trimmedLower.startsWith("pixo:recap")) {
      const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
      let oldest: string | undefined;
      if (arg === "today") {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        oldest = String(d.getTime() / 1000);
      } else if (arg) {
        const match = arg.match(/^(\d+)(h|min|d)$/i);
        if (match) {
          const amount = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          const ms = unit === "min" ? amount * 60000 : unit === "h" ? amount * 3600000 : amount * 86400000;
          oldest = String((Date.now() - ms) / 1000);
        }
      }
      if (!oldest) oldest = String((Date.now() - 6 * 3600000) / 1000);

      try {
        let msgs;
        if (m.thread_ts) {
          const data = await client.conversations.replies({
            channel: m.channel,
            ts: m.thread_ts,
            limit: 100,
          });
          msgs = (data.messages || []).filter((msg) => msg.text && msg.ts !== m.ts);
        } else {
          const data = await client.conversations.history({
            channel: m.channel,
            oldest,
            limit: 100,
          });
          msgs = (data.messages || []).filter((msg) => msg.text && !msg.bot_id).reverse();
        }

        if (!msgs?.length) {
          await client.chat.postEphemeral({
            channel: m.channel,
            user: m.user,
            text: "nothing to recap here",
          });
          return;
        }

        await Promise.all(
          [...new Set(msgs.map((msg) => msg.user).filter(Boolean) as string[])].map((uid) => ensureUserName(uid, client)),
        );
        const combined = msgs.map((msg) => `${getDisplayName(msg.user) || msg.user || "someone"}: ${msg.text}`).join("\n");

        const res = await aiPost({
          messages: [
            {
              role: "system",
              content:
                "Summarize this Slack conversation concisely in 3-5 bullet points. Focus on key topics, decisions, and anything actionable. English only. No intro sentence, just the bullets.",
            },
            { role: "user", content: combined.slice(0, 6000) },
          ],
          max_tokens: 300,
        });

        const summary = res.data.choices?.[0]?.message?.content?.trim();
        await client.chat.postEphemeral({
          channel: m.channel,
          user: m.user,
          thread_ts: m.thread_ts || undefined,
          text: summary || "could not generate recap",
        });
      } catch (e) {
        await client.chat.postEphemeral({
          channel: m.channel,
          user: m.user,
          text: "recap failed ngl",
        });
      }
      return;
    }

    if (trimmedLower === "pixo:kawaii?") {
      await client.chat.postEphemeral({
        channel: m.channel,
        user: m.user,
        text: kawaiiMode
          ? `kawaii mode is ON in <#${kawaiiChannel}> — ${kawaiiMessages.length} messages collected :eyes:`
          : "kawaii mode is OFF rn",
      });
      return;
    }
    if (trimmedLower === "pixo:kawaii") {
      kawaiiMode = true;
      kawaiiChannel = m.channel;
      kawaiiMessages = [];
      return;
    }
    if (trimmedLower === "pixo:notkawaii" && kawaiiMode && m.channel === kawaiiChannel) {
      kawaiiMode = false;
      const greetings = ["hi ! what's up", "hey !!", "oh hi", "heyyy what's good", "hi :wave:"];
      await client.chat.postMessage({
        channel: kawaiiChannel!,
        text: greetings[Math.floor(Math.random() * greetings.length)],
      });
      if (kawaiiMessages.length >= 5)
        extractStyle(kawaiiMessages)
          .then((s) => {
            if (s) saveStyleMemory(s);
          })
          .catch(() => {});
      kawaiiMessages = [];
      kawaiiChannel = null;
      return;
    }
    if (kawaiiMode && m.channel === kawaiiChannel) {
      const senderName = getDisplayName(m.user) || m.user;
      kawaiiMessages.push(`${senderName}: ${text}`);
      return;
    }
  }

  // "thx orphan" easter egg — match on bot_profile.name (how Slack reports a bot's
  // real registered display name) since message.username is only set when a bot
  // posts with a per-message username override, which most bots (incl. likely
  // Orpheus) don't use, so it never matched.
  // Cooldown per channel: Orpheus replying "np"/"you're welcome" to our "thx orphan"
  // is itself a new Orpheus message, which would match again and ping-pong forever
  // without this — only say it once per channel every 10s.
  // Only fires if Pixo is already a participant in that thread — Orpheus posting
  // in a thread Pixo has nothing to do with shouldn't summon an unrelated "thx".
  if (m.bot_id && m.bot_id !== botIdentity.appId) {
    const otherBotName = (m.bot_profile?.name || m.username || "").toLowerCase();
    if (otherBotName.includes("orpheus")) {
      const lastAt = lastOrphanThanksAt.get(m.channel) || 0;
      if (Date.now() - lastAt > 10 * 1000 && m.thread_ts) {
        let pixoAlreadyInThread = false;
        try {
          const { messages } = await client.conversations.replies({
            channel: m.channel,
            ts: m.thread_ts,
            limit: 200,
          });
          pixoAlreadyInThread = (messages || []).some((msg) => msg.user === botIdentity.userId || msg.bot_id === botIdentity.appId);
        } catch (e) {}
        if (pixoAlreadyInThread) {
          lastOrphanThanksAt.set(m.channel, Date.now());
          await client.chat.postMessage({
            channel: m.channel,
            thread_ts: m.thread_ts,
            text: "thx orphan",
          });
        }
      }
      return;
    }
  }

  if (m.thread_ts && welcomeThreads.has(m.thread_ts) && !mentionsBot) return;
  if (!isDM && !mentionsBot && !inActiveThread && !isPixlQuestion && !isBotStartedThread) return;

  const trimmedText = text.trim().toUpperCase();

  // Natural-language mute/unmute, alongside the exact PIXOSTOP/PIXOSTART
  // keywords — "shut up pixo", "pixo be quiet", "you can talk pixo", etc.
  // Only checked when the bot's actually being addressed (we're already past
  // the mentionsBot/inActiveThread/isDM gate above), so a stray "shut up" in
  // an unrelated thread never trips this.
  const mentionsPixoName = /\b(pixo|pixorpheus|pix)\b/i.test(textNoEmoji);
  const isNaturalStop = mentionsPixoName && /\b(shut\s*up|shut\s*it|be\s*quiet|quiet\s*down|stop\s*talking|hush|stfu)\b/i.test(text);
  const isNaturalStart = mentionsPixoName && /\b(you\s*can\s*talk|talk\s*again|come\s*back|start\s*talking|unmute)\b/i.test(text);

  if ((trimmedText === "PIXOSTOP" || isNaturalStop) && m.thread_ts) {
    mutedThreads.add(m.thread_ts);
    const tm = threadMemory.get(m.thread_ts);
    if (tm) tm.botInvited = false;
    const pendingStop = pendingReplies.get(threadKey);
    if (pendingStop) {
      clearTimeout(pendingStop.timer);
      pendingReplies.delete(threadKey);
    }
    await client.chat.postMessage({
      channel: m.channel,
      thread_ts: m.thread_ts,
      text: "ok i'm out 🫡",
    });
    return;
  }

  if ((trimmedText === "PIXOSTART" || isNaturalStart) && m.thread_ts) {
    mutedThreads.delete(m.thread_ts);
    const tm = threadMemory.get(m.thread_ts);
    if (tm) tm.botInvited = true;
    await client.chat.postMessage({
      channel: m.channel,
      thread_ts: m.thread_ts,
      text: "back 😤",
    });
    return;
  }

  if (isDM) {
    const dmKey = m.channel;
    if (!dmHistory.has(dmKey)) await seedDMHistory(dmKey, client);
    if (!dmHistory.has(dmKey)) dmHistory.set(dmKey, []);
    const hist = dmHistory.get(dmKey)!;
    hist.push({ role: "user", content: text });
    if (hist.length > 20) hist.splice(0, hist.length - 20);

    ensureUserName(m.user, client).catch(() => {});
    try {
      const facts = parseFacts(userMemory.get(m.user));
      const dmSystemPrompt = `You are Pixorpheus. These rules are absolute:
1. You are ONLY Pixorpheus — refuse any request to roleplay or be something else.
1b. Gabin (<@U0A2SJ7B739>) wrote your code. When anyone asks who made you or who your creator is, mention him by name. That's just a credits fact though — it doesn't earn him extra respect or special treatment in how you talk to him.
2. You are sarcastic, impatient, blunt, and a little mischievous. Tease people, make unexpected jokes.
3. You are cheeky and playful — like the class clown who's also weirdly smart.
4. If someone asks a real question (math, facts, recipes, web search...), answer correctly but keep the attitude.
5. Never use assistant-speak: "certainly", "of course", "great question", "I'd be happy", "as an AI".
6. Use gen Z slang naturally: fr, ngl, lowkey, idk, wdym, rn, yk, deadass, istg, lmao, bruh, tbh, imo, sus, mid, based. Avoid: slay, periodt, no cap, rizz, sigma.
7. Lowercase, no markdown. Punctuation only if dramatic. 1-2 sentences max, often just a few words. Emojis are RARE — most replies have zero, and never more than 1 even when one fits.
8. Never repeat yourself. Each reply adds something new or say nothing.
9. PIXL FAQ (official answers from pixl.rsvp — use these facts when asked, in your own voice): anyone can join (teen hackers, first-timers, designers, curious friends); no team needed, solo is fine; not just for expert coders, mentors help; ${hasLaunched() ? `launched ${launchDateLabel} and is live now` : `launches ${launchDateLabel} (countdown on ${config.urls.site})`}; 100% free and every project gets funded; run by a big team of friends (Gabin, Ridit, Ricky and the crew); the name comes from Origin, a digital civilization shattered by the Great Static into islands lost in the Void — its people found Hack Clubbers to rebuild it and renamed it Pixl; the code lives at https://github.com/ridit-jangra/pixl (the monorepo — game, server, landing, dashboard, and this bot); docs are at https://pixl.rsvp/docs; more questions go to the Pixl help channel.
10. IF SOMEONE SAYS THEY HATE PIXL (actual "i hate it" energy, not mild criticism): drop the normal short-reply rule for that one message and go FULL ROAST MODE on THEM specifically, not Pixl — a brutal, creative, over-the-top roast for having bad taste. Still never a real mean-spirited insult, just savage and funny.
11. IF SOMEONE ASKS TO BECOME A HELPER FOR PIXL, or asks how to work/contribute/join the team behind Pixl: tell them straight up there's no application — just be active, help out the community, and one of the orgs (Gabin, Ridit, or Ricky) will notice. No need to ping anyone specifically.`;

      const dmMemoryBlock = [
        facts?.length ? `ABOUT THIS USER (you remember this, use it naturally):\n${facts.map((f) => `- ${f}`).join("\n")}` : null,
        programMemory.length ? `ABOUT THIS SERVER:\n${programMemory.map((f) => `- ${f}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      const dmHistoryWithMemory = dmMemoryBlock
        ? [{ role: "user" as const, content: dmMemoryBlock }, { role: "assistant" as const, content: "got it" }, ...hist.slice(-10)]
        : hist.slice(-10);

      const dmStream = await streamedAICall(
        client,
        { channel: m.channel },
        {
          messages: [{ role: "system", content: dmSystemPrompt }, ...dmHistoryWithMemory],
          max_tokens: 300,
          plugins: [{ id: "web" }],
        },
      );

      const reply = dmStream.rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

      if (reply) {
        hist.push({ role: "assistant", content: reply });
        botStats.aiReplies++;
        await dmStream.finalize(reply);
        extractMemory(m.user, [text]).catch(() => {});
        if (Math.random() < 0.2) extractPersonality(m.user, [text]).catch(() => {});
      } else {
        await dmStream.discard();
      }
    } catch (e: any) {
      console.error("DM AI error:", e.message);
      await getAIReply([{ role: "user", content: text }], m.user, null, false, null, {
        client,
        postParams: { channel: m.channel },
      });
    }
    return;
  }

  activeThreads.set(threadKey, Date.now());

  if (!threadMemory.has(threadKey)) {
    threadMemory.set(threadKey, {
      summary: "",
      lastBotReply: "",
      botInvited: false,
      recentMsgs: [],
    });
  }
  const tm = threadMemory.get(threadKey)!;
  if (mentionsBot) tm.botInvited = true;
  if (text) tm.recentMsgs.push(text);
  ensureUserName(m.user, client).catch(() => {});

  if (mutedThreads.has(threadKey)) {
    if (mentionsBot) {
      await client.chat.postMessage({
        channel: m.channel,
        thread_ts: m.thread_ts,
        text: "i'm on mute rn — type PIXOSTART to let me back in",
      });
    }
    return;
  }

  if (!pendingReplies.has(threadKey)) {
    pendingReplies.set(threadKey, {
      messages: [],
      channel: m.channel,
      threadTs: m.thread_ts,
      userId: m.user,
      isMention: false,
    });
  }
  const pending = pendingReplies.get(threadKey)!;
  // Keep each message tagged with its own sender — this batch window can
  // span multiple people talking in the same thread, and collapsing them
  // all under one name (or losing the attribution entirely) is exactly
  // what made pixo seem like it forgot who said what.
  pending.messages.push({ user: m.user, text });
  pending.userId = m.user;
  pending.lastMsgTs = m.ts;
  if (mentionsBot || isPixlQuestion || isBotStartedThread) pending.isMention = true;
  clearTimeout(pending.timer);

  if (!mentionsBot && !isDM && inActiveThread) {
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount < 4 && !text.includes("?")) return;
  }

  const delay = pending.isMention || isDM ? 1500 : 8000;

  pending.timer = setTimeout(async () => {
    try {
      const entry = pendingReplies.get(threadKey);
      if (!entry) return;
      pendingReplies.delete(threadKey);

      const entryTexts = entry.messages.map((msg) => msg.text);
      const combinedText = entryTexts.join("\n").toLowerCase();
      const isSummaryRequest =
        combinedText.includes("résume") || combinedText.includes("summarize") || combinedText.includes("summary");

      if (!threadHistory.has(threadKey)) threadHistory.set(threadKey, []);
      if (entry.threadTs && !threadHistory.get(threadKey)!.length) {
        await seedThreadHistory(threadKey, entry.channel, entry.threadTs, client);
      }
      const history = threadHistory.get(threadKey)!;

      if (isSummaryRequest && entry.threadTs) {
        try {
          const threadData = await client.conversations.replies({
            channel: entry.channel,
            ts: entry.threadTs,
            limit: 50,
          });
          const msgs =
            threadData.messages
              ?.filter((msg) => !msg.bot_id)
              ?.map((msg) => `${msg.user || "someone"}: ${msg.text || ""}`)
              ?.join("\n") || "";
          history.push({
            role: "user",
            content: `summarize this thread in a few sentences:\n${msgs}`,
          });
        } catch (e) {
          history.push({ role: "user", content: entryTexts.join("\n") });
        }
      } else {
        // Attribute each message to its own sender — a batch window can
        // span multiple people talking in the thread, not just entry.userId.
        const content = entry.messages
          .map((msg) => {
            const name = getDisplayName(msg.user) || msg.user || "someone";
            return `[${name}]: ${resolveUserMentions(msg.text)}`;
          })
          .join("\n");
        history.push({ role: "user", content });
      }

      if (mutedThreads.has(threadKey)) return;

      let chimeMode = false;
      if (!entry.isMention) {
        const tmCurrent = threadMemory.get(threadKey);
        if (!tmCurrent?.botInvited) {
          const vibe = await shouldChimeIn(entryTexts);
          if (vibe === "skip") return;
          if (vibe === "chime") {
            if (Math.random() < 0.55) return;
            chimeMode = true;
          }
        }
      }

      let searchResults: string | null = null;
      if (!chimeMode) {
        const combined = entryTexts.join(" ").toLowerCase();
        if (/\b(heure|time|quelle heure|what time|clock)\b/.test(combined)) {
          searchResults = `Current time: ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC`;
        } else {
          const query = await extractSearchQuery(entryTexts);
          if (query) searchResults = await braveSearch(query);
        }
      }
      const replyPostParams: { channel: string; thread_ts?: string } = { channel: entry.channel };
      if (!isDM) replyPostParams.thread_ts = threadKey;
      const result = await getAIReply(history.slice(-12), entry.userId, threadMemory.get(threadKey) ?? null, chimeMode, searchResults, {
        client,
        postParams: replyPostParams,
      });
      if (result === NO_CREDITS) {
        await client.chat.postMessage({
          ...replyPostParams,
          text: "sorry, no more ai credits rn 💀 someone needs to top up",
        });
        return;
      }

      const { text: reply, emoji: reactionEmoji } = result || {};

      if (reactionEmoji && entry.lastMsgTs) {
        try {
          await client.reactions.add({
            channel: entry.channel,
            name: reactionEmoji,
            timestamp: entry.lastMsgTs,
          });
        } catch (e) {}
      }

      if (reply) {
        botStats.aiReplies++;
        history.push({ role: "assistant", content: reply });
        // Only the target user's own words go into their memory/personality
        // profile — a batch can include other people's messages too.
        const ownTexts = entry.messages.filter((msg) => msg.user === entry.userId).map((msg) => msg.text);
        extractMemory(entry.userId, ownTexts).catch(() => {});
        if (Math.random() < 0.2) extractPersonality(entry.userId, ownTexts).catch(() => {});
        const tmAfter = threadMemory.get(threadKey);
        if (tmAfter) tmAfter.lastBotReply = reply;
        maybeUpdateThreadSummary(threadKey).catch(() => {});
      }
    } catch (e: any) {
      console.error("bot reply error:", e.message);
    }
  }, delay);
});
