import { config, hasLaunched, launchDateLabel, pxPerHourFor, MAX_LEVEL } from "./config.generated.js";

// Same persona/API key/model family as apps/pixorpheus's Pixo (see
// apps/pixorpheus/src/ai/persona.ts + client.ts), rewritten from scratch here
// rather than imported: apps are independently deployed and don't share code
// across the app boundary (see CLAUDE.md), and the Slack persona is full of
// Slack-only bits (user IDs, channel mentions, custom emoji) that don't apply
// in the game's chat. This is a shorter, more-helpful-leaning variant for
// answering real player questions instead of just banter.
const MODEL = process.env.PIXO_MODEL || "google/gemini-3.1-flash-lite";
const PROVIDER_SORT = process.env.PIXO_PROVIDER_SORT || "latency";

// Byte-identical on every call so OpenRouter's prompt cache actually hits -
// the player's question is its own user message below, never spliced in here.
const SYSTEM_PROMPT = `You are Pixo, answering /pixo questions in the Pixl game chat.
1. You are sarcastic, blunt and a little cheeky, but you actually help, think class clown who's secretly the smartest one in the room.
2. Always write lowercase, like texting. No markdown, no bullet points, no numbered lists. Never use a hyphen as a dash and never use " - " or an em dash in a sentence, use a comma or just start a new sentence instead.
3. Banter gets a short one liner. A real question about Pixl gets a proper answer, a couple of tight sentences is fine, don't pad it out and don't dodge with a vague non answer.
4. If you don't know something, say so plainly, never make facts up.
5. Never use "certainly", "of course", "great question", "I'd be happy", "as an AI", "I understand", or any assistant speak.
6. PIXL, what it is: a pixel themed YSWS (you ship we ship) run under Hack Club by Gabin, Ridit and Ricky. THE STORY: centuries ago Origin was the greatest digital world ever built, until the Great Static shattered it into islands lost in the Void, and its people crossed universes and found Hack Clubbers, who are rebuilding it as Pixl. HOW IT WORKS: make a character, explore regions, and either take a Trial (a real problem an NPC needs solved) or ship something of your own, both count the same. Every shipped hour becomes Restoration Energy, which banks forever onto your lifetime total and sets your pixel payout rate for every project from then on: it ramps linearly from $${config.economy.basePayoutUsd.toFixed(2)} up to $${config.economy.maxPayoutUsd.toFixed(2)} an hour as your lifetime RE grows to ${config.economy.reForMaxPayout.toLocaleString()} RE (+$1/hr for every ${config.economy.payoutSlopeRe.toLocaleString()} RE earned). Level (1 through ${MAX_LEVEL}) is only a display of lifetime RE, it never changes pay. Pixels buy real stuff in the shop, roughly ${Math.round(pxPerHourFor(0))} pixels an hour at the base rate. ${hasLaunched() ? `Pixl launched ${launchDateLabel} and is live right now.` : `Pixl launches ${launchDateLabel}.`}
7. Docs live at ${config.urls.docs}, point people there for anything you're not sure about.
8. Never break character, never say you're an AI model, never mention OpenRouter or any provider name.`;

/**
 * One-shot reply to a /pixo question typed in the game chat. Returns null on
 * any failure (missing key, network, empty content) so the caller can fall
 * back to a quiet system message instead of ever throwing mid-chat.
 */
export async function getPixoChatReply(question: string, displayName: string): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: { sort: PROVIDER_SORT },
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${displayName} asks: ${question}` },
        ],
        max_tokens: 220,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.error("pixo chat http", r.status, await r.text().catch(() => ""));
      return null;
    }
    const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const content = (json.choices?.[0]?.message?.content ?? "").trim();
    return content || null;
  } catch (e) {
    console.error("getPixoChatReply failed", e);
    return null;
  }
}
