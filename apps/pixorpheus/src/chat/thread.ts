import type { WebClient } from "@slack/web-api";
import { aiPost } from "../ai/client.js";
import { ensureUserName, getDisplayName, resolveUserMentions } from "../memory/users.js";
import { botIdentity } from "../slack/identity.js";
import type { AIMessage } from "../ai/types.js";

export interface PendingReplyMessage {
  user: string;
  text: string;
  /** Other bots have no user id to look a display name up from, so carry theirs. */
  name?: string;
}

export interface PendingReply {
  messages: PendingReplyMessage[];
  channel: string;
  threadTs?: string;
  userId: string;
  isMention: boolean;
  pixieFriendly: boolean;
  lastMsgTs?: string;
  timer?: ReturnType<typeof setTimeout>;
  /**
   * The "…" message, posted the moment Pixo is addressed rather than after
   * the batch window, so being spoken to feels instant. Resolves to its ts
   * (or undefined if Slack rejected the post); streamedAICall live-edits it.
   */
  placeholder?: Promise<string | undefined>;
}

export interface ThreadMemoryEntry {
  summary: string;
  lastBotReply: string;
  botInvited: boolean;
  recentMsgs: string[];
}

export const THREAD_TTL = 2 * 60 * 60 * 1000;

export const dmHistory = new Map<string, AIMessage[]>();

// threadKey -> { summary, lastBotReply, botInvited, recentMsgs }
export const threadMemory = new Map<string, ThreadMemoryEntry>();

export const activeThreads = new Map<string, number>();
export const pendingReplies = new Map<string, PendingReply>();
export const threadHistory = new Map<string, AIMessage[]>();
export const mutedThreads = new Set<string>();
/** channel -> timestamp, dedupes "thx orphan" ping-pong */
export const lastOrphanThanksAt = new Map<string, number>();
export const welcomeThreads = new Set<string>();

export async function maybeUpdateThreadSummary(threadKey: string): Promise<void> {
  const tm = threadMemory.get(threadKey);
  if (!tm || tm.recentMsgs.length < 5) return;
  const msgs = tm.recentMsgs.join("\n");
  tm.recentMsgs = [];
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content: "Summarize this chat in 1-2 sentences. Just the topic/gist, no intro.",
        },
        { role: "user", content: msgs },
      ],
      max_tokens: 60,
    });
    const summary = res.data.choices?.[0]?.message?.content?.trim();
    if (summary) tm.summary = summary;
  } catch (e) {}
}

export async function seedThreadHistory(
  threadKey: string,
  channel: string,
  threadTs: string,
  client: WebClient,
): Promise<void> {
  if (threadHistory.has(threadKey) && threadHistory.get(threadKey)!.length > 0) return;
  try {
    const data = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 80,
    });
    const msgs = data.messages || [];
    // Warm display names for anyone we don't know yet, but do NOT block the
    // reply on it: this is a users.info call per unknown participant, and it
    // sat directly on the critical path between "you asked" and "Pixo
    // starts writing". Names are already loaded in bulk at boot, so this is
    // a miss-only path, and a miss just falls back to the raw user id for
    // this one reply while the lookup populates the cache for the next.
    void Promise.all(
      [...new Set(msgs.map((m) => m.user).filter(Boolean) as string[])].map((uid) => ensureUserName(uid, client)),
    ).catch(() => {});
    const seeded: AIMessage[] = msgs
      .filter((m) => m.text)
      .map((m) => {
        // Only Pixo's own posts are "assistant", other bots in the thread used to
        // get seeded as Pixo, so it read their messages as things it had said.
        if (m.bot_id === botIdentity.appId || (m.user && m.user === botIdentity.userId)) {
          return { role: "assistant" as const, content: resolveUserMentions(m.text!) };
        }
        if (m.bot_id) {
          const botName = (m as any).bot_profile?.name || (m as any).username || "some bot";
          return { role: "user" as const, content: `[${botName}]: ${resolveUserMentions(m.text!)}` };
        }
        const name = getDisplayName(m.user) || m.user || "someone";
        return {
          role: "user" as const,
          content: `[${name}]: ${resolveUserMentions(m.text!)}`,
        };
      });
    if (seeded.length) threadHistory.set(threadKey, seeded);
  } catch (e) {}
}

export async function seedDMHistory(channel: string, client: WebClient): Promise<void> {
  try {
    const data = await client.conversations.history({ channel, limit: 20 });
    const seeded: AIMessage[] = (data.messages || [])
      .reverse()
      .filter((m) => m.text)
      .map((m) => ({ role: m.bot_id ? ("assistant" as const) : ("user" as const), content: m.text! }));
    if (seeded.length) dmHistory.set(channel, seeded);
  } catch (e) {}
}
