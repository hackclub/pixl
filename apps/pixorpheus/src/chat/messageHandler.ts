import { app } from "../slack/app.js";
import { PIXL_REVIEW_CHANNEL, SILENCED_CHANNELS, TRAINING_CHANNEL } from "../constants.js";
import { botIdentity } from "../slack/identity.js";
import { aiPost } from "../ai/client.js";
import { sanitizeAIOutput } from "../ai/outputFilter.js";
import { extractStyle } from "../memory/style.js";
import { saveStyleMemory } from "../memory/style.js";
import { ensureUserName, getDisplayName } from "../memory/users.js";
import { isTrainingAllowed } from "./training.js";
import { lastOrphanThanksAt } from "./thread.js";
import { getStoredCompact, computeCompactSince, compactDateStr } from "./dailyCompact.js";
import { handleFulfillmentAlertCommand, parseFulfillmentAlertCommand } from "../commands/fulfillmentAlerts.js";

// Matches "pixo:compact", "pixo /compact", "pixorpheus /compact", and
// "@pixorpheus /compact", always requires a leading bot reference (mention
// or "pixo"/"pixorpheus"), same discipline as pixo:recap, so a bare
// "/compact" typed with no bot reference never fires this. Optional trailing
// arg like "yesterday". Returns the lowercased arg (possibly "") or null.
function matchCompactCommand(rawText: string, botUserId: string | null): string | null {
  let t = rawText.trim();
  let hadPrefix = false;
  if (botUserId) {
    const stripped = t.replace(new RegExp(`^<@${botUserId}>\\s*`), "");
    if (stripped !== t) {
      hadPrefix = true;
      t = stripped;
    }
  }
  const strippedName = t.replace(/^pixo(?:rpheus)?[\s:]+/i, "");
  if (strippedName !== t) {
    hadPrefix = true;
    t = strippedName;
  }
  if (!hadPrefix) return null;
  const m = t.match(/^\/?compact\b\s*(.*)$/i);
  return m ? m[1].trim().toLowerCase() : null;
}

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
  const fulfillmentAlertAction = parseFulfillmentAlertCommand(text);
  if (fulfillmentAlertAction) {
    if (typeof m.user !== "string") return;
    const reply = isDM
      ? await handleFulfillmentAlertCommand(m.user, fulfillmentAlertAction)
      : "DM Pixorpheus to manage your new-order alerts.";
    if (isDM) {
      await client.chat.postMessage({ channel: m.channel, text: reply });
    } else {
      await client.chat.postEphemeral({ channel: m.channel, user: m.user, text: reply });
    }
    return;
  }
  // Slack emoji shortcodes like :yay-pixo: or :pix-wave: literally contain
  // "pixo"/"pix" and used to falsely trigger the bot. Strip every :shortcode:
  // before any name-mention check so only the name in actual prose counts.
  const textNoEmoji = text.replace(/:[a-z0-9_'+-]+:/gi, " ");
  const lowerText = textNoEmoji.toLowerCase();
  // The review channel is for humans discussing verdicts in the threads Pixo
  // posts, so Pixo stays out of it unless it is explicitly @mentioned (a bare
  // "pixo" in prose, a Pixl question or a bot-started thread don't count).
  if (
    m.channel === PIXL_REVIEW_CHANNEL &&
    !(botIdentity.userId && text.includes(`<@${botIdentity.userId}>`))
  )
    return;
  // Training mode - intercept before the bot mention filter. Admins in the
  // training channel only (see chat/training.ts); everyone else's messages
  // fall through to normal handling and are never collected.
  if (!m.bot_id && isTrainingAllowed(m.user, m.channel)) {
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
          text: `got it, i've absorbed your vibe :brain: i'll talk more like you now\n\n_style notes saved, ${trainingMessages.length} messages analyzed_`,
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

  // Kawaii stealth mode - admins in the training channel only, silent start
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

        // Model output summarizing player messages: same output filter as
        // every other AI reply ("" means it was dropped whole).
        const summary = sanitizeAIOutput(res.data.choices?.[0]?.message?.content?.trim() || "").trim();
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

    const compactArg = matchCompactCommand(text, botIdentity.userId);
    if (compactArg !== null) {
      const threadTs = m.thread_ts || m.ts;
      try {
        let label = "today";
        let result: { summary: string; messageCount: number } | null;
        if (compactArg === "yesterday") {
          label = "yesterday";
          result = await getStoredCompact(compactDateStr(1), m.channel);
          if (!result) result = await computeCompactSince(1, m.channel);
        } else {
          result = await computeCompactSince(0, m.channel);
        }
        const intro =
          label === "yesterday"
            ? `here's what you missed yesterday (${result?.messageCount ?? 0} messages), catch up lazy :3c:`
            : `ok here's the compact for today so far (${result?.messageCount ?? 0} messages):`;
        const empty =
          label === "yesterday" ? "yesterday was mad quiet, nothing to compact ngl" : "nothing's happened today yet, too quiet in here rn";
        await client.chat.postMessage({
          channel: m.channel,
          thread_ts: threadTs,
          text: result ? `${intro}\n${result.summary}` : empty,
        });
      } catch (e) {
        await client.chat.postMessage({
          channel: m.channel,
          thread_ts: threadTs,
          text: "compact broke on me ngl, try again in a sec",
        });
      }
      return;
    }

    const trainingAllowed = isTrainingAllowed(m.user, m.channel);
    if (trimmedLower === "pixo:kawaii?" && trainingAllowed) {
      await client.chat.postEphemeral({
        channel: m.channel,
        user: m.user,
        text: kawaiiMode
          ? `kawaii mode is ON in <#${kawaiiChannel}>, ${kawaiiMessages.length} messages collected :eyes:`
          : "kawaii mode is OFF rn",
      });
      return;
    }
    if (trimmedLower === "pixo:kawaii" && trainingAllowed) {
      kawaiiMode = true;
      kawaiiChannel = m.channel;
      kawaiiMessages = [];
      return;
    }
    if (trimmedLower === "pixo:notkawaii" && trainingAllowed && kawaiiMode && m.channel === kawaiiChannel) {
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
    if (kawaiiMode && trainingAllowed && m.channel === kawaiiChannel) {
      const senderName = getDisplayName(m.user) || m.user;
      kawaiiMessages.push(`${senderName}: ${text}`);
      return;
    }
  }

  // "thx orphan" easter egg, match on bot_profile.name (how Slack reports a bot's
  // real registered display name) since message.username is only set when a bot
  // posts with a per-message username override, which most bots (incl. likely
  // Orpheus) don't use, so it never matched.
  // Cooldown per channel: Orpheus replying "np"/"you're welcome" to our "thx orphan"
  // is itself a new Orpheus message, which would match again and ping-pong forever
  // without this, only say it once per channel every 10s.
  // Only fires if Pixo is already a participant in that thread, Orpheus posting
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
});
