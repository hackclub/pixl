import type { WebClient } from "@slack/web-api";

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * A system message sent as content blocks so a cache breakpoint can be
 * attached. Everything before the breakpoint has to be byte-identical
 * between requests or the cache never hits, which is why the per-message
 * situational text lives in a later user turn instead of inside this.
 */
export interface AICachedSystemMessage {
  role: "system";
  content: {
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }[];
}

export interface AIRequestBody {
  messages: (AIMessage | AICachedSystemMessage)[];
  max_tokens?: number;
  plugins?: { id: string }[];
  [key: string]: unknown;
}

/** Mirrors the OpenRouter chat-completions response shape we actually read. */
export interface AIResponse {
  data: {
    choices?: { message?: { content?: string } }[];
  };
}

/**
 * Minimal Slack postMessage params, every streaming call site builds one
 * of these (channel is required, thread_ts is the only other field used).
 */
export interface SlackPostParams {
  channel: string;
  thread_ts?: string;
  [key: string]: unknown;
}

/**
 * Passed to getAIReply to have it post-and-live-edit a placeholder message
 * instead of returning text for the caller to post itself.
 */
export interface StreamTarget {
  client: WebClient;
  postParams: SlackPostParams;
  format?: (text: string) => string;
  /** Already-posted placeholder ts to live-edit instead of posting a new one. */
  placeholder?: Promise<string | undefined>;
}

/** Per-thread context getAIReply weaves into its system prompt. */
export interface ThreadContext {
  summary?: string;
  lastBotReply?: string;
  botInvited?: boolean;
}

export interface AIReplyResult {
  text: string | null;
  emoji: string | null;
}
