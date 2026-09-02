import type { WebClient } from "@slack/web-api";
import type { AIRequestBody, AIResponse, SlackPostParams } from "./types.js";
import { sanitizeAIOutput } from "./outputFilter.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const NO_CREDITS = "__NO_CREDITS__";
export const RATE_LIMITED = "__RATE_LIMITED__";

export class AIError extends Error {
  code: typeof NO_CREDITS | typeof RATE_LIMITED;
  constructor(message: string, code: typeof NO_CREDITS | typeof RATE_LIMITED) {
    super(message);
    this.code = code;
  }
}

function headers(openrouterKey: string) {
  return {
    Authorization: `Bearer ${openrouterKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://pixorpheus.app",
    "X-Title": "Pixorpheus",
  };
}

/**
 * One POST to OpenRouter on native fetch. fetch keeps the connection to
 * openrouter.ai pooled between calls, so only the very first request of the
 * process pays for DNS + the TLS handshake, axios opened a fresh socket
 * every time, which was a few hundred ms of pure handshake on every single
 * reply. Non-2xx is turned into the same AIError the callers already handle
 * (fetch, unlike axios, doesn't throw on a bad status).
 */
async function postOpenRouter(
  openrouterKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: headers(openrouterKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    console.error("[openrouter] network error:", e?.message);
    throw new AIError("transient error", RATE_LIMITED);
  }
  if (res.ok) return res;

  const detail = await res.text().catch(() => "");
  if (res.status === 429) {
    console.warn("[openrouter] rate limited (429) - staying silent");
    throw new AIError("rate limited", RATE_LIMITED);
  }
  if (res.status === 402) {
    console.error("[openrouter] no credits (402)");
    throw new AIError("no credits", NO_CREDITS);
  }
  console.error("[openrouter] failed (status", res.status, "):", detail.slice(0, 200));
  throw new AIError("transient error", RATE_LIMITED);
}

/**
 * onDelta(accumulatedText) is called as tokens stream in from OpenRouter.
 * Omit it to get the old buffered behavior (single response once it's all
 * in). Either way the return shape is the same: res.data.choices[0].message.content.
 *
 * Persona chat / roasts / classification model. Gemini 3.1 Flash Lite by
 * default, cheap and fast for this high-volume bot. Override with
 * PIXO_MODEL if you want more punch.
 *
 * Routed by latency, NOT by ":nitro". :nitro is exactly equivalent to
 * provider.sort "throughput", i.e. tokens per second once generation is
 * already running. Pixo's replies are 2-8 words, so throughput is nearly
 * irrelevant to it and the whole wait is time-to-first-token, which is what
 * sort "latency" actually optimizes. Set PIXO_PROVIDER_SORT to override.
 */
export async function aiCall(
  body: AIRequestBody,
  onDelta?: (accumulated: string) => void,
): Promise<AIResponse> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) throw new AIError("no credits", NO_CREDITS);

  const orBody = {
    provider: { sort: process.env.PIXO_PROVIDER_SORT || "latency" },
    ...body,
    model: process.env.PIXO_MODEL || "google/gemini-3.1-flash-lite",
  };

  if (!onDelta) {
    const res = await postOpenRouter(openrouterKey, orBody, 25000);
    const data = (await res.json().catch(() => ({}))) as AIResponse["data"];
    console.log(
      "[openrouter] ok - content:",
      JSON.stringify(data?.choices?.[0]?.message?.content)?.slice(0, 80),
    );
    return { data };
  }

  // Streaming path: OpenRouter forwards an SSE stream of
  // "data: {...}\n\n" chunks, each with a choices[0].delta.content
  // fragment, terminated by "data: [DONE]".
  const res = await postOpenRouter(openrouterKey, { ...orBody, stream: true }, 45000);
  if (!res.body) throw new AIError("transient error", RATE_LIMITED);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (!raw.startsWith("data:")) continue;
        const payload = raw.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(full);
          }
        } catch (e) {
          // ignore malformed chunk, keep streaming
        }
      }
    }
  } catch (e: any) {
    console.error("[openrouter] stream failed:", e?.message);
    throw new AIError("transient error", RATE_LIMITED);
  } finally {
    reader.cancel().catch(() => {});
  }
  console.log("[openrouter] ok (stream) - content:", JSON.stringify(full).slice(0, 80));
  return { data: { choices: [{ message: { content: full } }] } };
}

/** Aliases kept from the original code, same function, different call-site intent. */
export const aiPost = aiCall;
export const aiClassify = aiCall;

/**
 * Applied to the accumulated buffer on every throttled preview update (not
 * just the final text) so a live-streaming reply never flashes something it
 * shouldn't: an in-progress <think> reasoning block, a not-yet-complete
 * REACT: directive line, or (for the SKIP protocol some prompts use) the
 * word "skip" itself.
 */
export function safeDisplayText(raw: string, { stripSkip = false }: { stripSkip?: boolean } = {}): string {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const openIdx = t.search(/<think>/i);
  if (openIdx !== -1) t = t.slice(0, openIdx);
  const reactIdx = t.search(/\n\s*REACT\s*:/i);
  if (reactIdx !== -1) t = t.slice(0, reactIdx);
  if (stripSkip) t = t.replace(/^skip\b\s*\n?/i, "");
  return sanitizeAIOutput(t.trim());
}

const STREAM_UPDATE_INTERVAL_MS = 900;

export interface StreamedCallHandle {
  rawContent: string;
  finalize(finalText: string | null | undefined): Promise<void>;
  discard(): Promise<void>;
}

/**
 * Posts a placeholder message immediately, then live-edits it as the model
 * streams in (throttled to respect Slack's chat.update rate limit, Slack
 * will start 429ing well before "every token" territory). Callers get back
 * the raw completion text to run their own leak-detection/cleanup on
 * exactly as they did before streaming existed, then call finalize(text)
 * with the real final text (does the closing edit) or discard() if there's
 * nothing worth keeping (empty reply, detected prompt leak, etc).
 *
 * `format` wraps both the live preview and is available for the caller's
 * own final text too, e.g. roast prefixes every update with "<@user> ".
 * Ephemeral responses (respond()/chat.postEphemeral) can't use this: Slack
 * has no way to edit an ephemeral message after the fact.
 */
export async function streamedAICall(
  client: WebClient,
  postParams: SlackPostParams,
  aiBody: AIRequestBody,
  {
    format,
    stripSkip,
    placeholder,
  }: {
    format?: (text: string) => string;
    stripSkip?: boolean;
    /**
     * A placeholder the caller already posted (and is therefore already
     * on-screen). Callers that do slow prep before getting here - seeding
     * thread history, a web search - post it up front so the user sees Pixo
     * react immediately instead of staring at nothing until the model is
     * ready. Omit it and this posts its own, exactly as before.
     */
    placeholder?: Promise<string | undefined>;
  } = {},
): Promise<StreamedCallHandle> {
  const fmt = format || ((t: string) => t);
  let ts: string | undefined;
  let lastUpdate = 0;
  let lastShown: string | null = null;
  let latestFull = "";

  /**
   * Every chat.update for this message goes through one chain, so Slack
   * receives them in the order we issued them.
   *
   * These used to be fired concurrently and never awaited. Two edits of the
   * same message were then racing over the network, and a slow preview edit
   * ("gabin") could land AFTER the final complete reply ("gabin built the
   * bot...") and silently clobber it. On screen that reads as Pixo starting
   * to answer and then stopping mid-word, which is exactly what people saw.
   * Chaining costs nothing here: the throttle already limits how many of
   * these exist, and finalize awaits the chain so it always writes last.
   */
  let editChain: Promise<unknown> = Promise.resolve();
  const enqueueEdit = (text: string): Promise<unknown> => {
    editChain = editChain.then(() =>
      client.chat.update({ channel: postParams.channel, ts: ts!, text }).catch(() => {}),
    );
    return editChain;
  };

  const pushUpdate = (full: string, force = false) => {
    if (!ts) return;
    const display = safeDisplayText(full, { stripSkip });
    if (!display || display === lastShown) return;
    const now = Date.now();
    if (!force && now - lastUpdate < STREAM_UPDATE_INTERVAL_MS) return;
    lastUpdate = now;
    lastShown = display;
    enqueueEdit(fmt(display));
  };

  // Post the placeholder and start asking the model at the same time, the
  // model can already be generating tokens while we're still waiting on
  // Slack to confirm the placeholder, instead of paying for those two
  // network round-trips back to back. Whatever streamed in during that
  // wait gets flushed immediately once the placeholder lands, bypassing
  // the throttle for that first flush so it doesn't sit on-screen as "…"
  // for up to another 900ms for no reason.
  const placeholderPromise = (
    placeholder ?? client.chat.postMessage({ ...postParams, text: fmt("…") }).then((p) => p.ts)
  )
    .then((postedTs) => {
      ts = postedTs;
      if (latestFull) pushUpdate(latestFull, true);
    })
    .catch(() => {
      // no placeholder, fall back to a single non-streamed post in finalize()
    });

  const onDelta = (full: string) => {
    latestFull = full;
    pushUpdate(full);
  };

  let res: AIResponse;
  try {
    res = await aiCall(aiBody, onDelta);
  } catch (e) {
    await placeholderPromise;
    if (ts) client.chat.delete({ channel: postParams.channel, ts }).catch(() => {});
    throw e;
  }
  await placeholderPromise;

  const rawContent = res.data.choices?.[0]?.message?.content || "";
  return {
    rawContent,
    async finalize(finalText) {
      const safeText = finalText ? sanitizeAIOutput(finalText) : finalText;
      if (!ts) {
        if (safeText) await client.chat.postMessage({ ...postParams, text: safeText });
        return;
      }
      // Let every queued preview edit land first, then write the real reply
      // as the last edit. Without this the closing edit races the previews
      // and a half-finished one can win, leaving a truncated answer.
      await editChain;
      if (!safeText) {
        await client.chat.delete({ channel: postParams.channel, ts }).catch(() => {});
        return;
      }
      await enqueueEdit(safeText);
    },
    async discard() {
      if (!ts) return;
      await editChain;
      await client.chat.delete({ channel: postParams.channel, ts }).catch(() => {});
    },
  };
}
