import { aiClassify } from "./client.js";
import { resolveUserMentions } from "../memory/users.js";
import { botIdentity } from "../slack/identity.js";

export async function braveSearch(query: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          "X-Subscription-Token": process.env.BRAVE_SEARCH_KEY!,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { web?: { results?: { title: string; description: string }[] } };
    const results = data.web?.results || [];
    return results
      .slice(0, 4)
      .map((r: { title: string; description: string }) => `${r.title}: ${r.description}`)
      .join("\n");
  } catch (e) {
    return null;
  }
}

/** Things only the live web can answer: fresh facts, prices, releases, scores. */
const WEB_HINTS =
  /\b(news|latest|current(ly)?|today|tonight|tomorrow|yesterday|recent(ly)?|price|prices|cost|worth|stock|weather|forecast|score|scored|winner|won|released?|releasing|launch(ed|ing)?|announce[ds]?|update[ds]?|version|patch|trending|happening|right now|this (week|month|year)|20\d\d|look ?up|google|search (for|up))\b/i;

/**
 * A lookup-shaped question. Deliberately does not require a "?", people
 * type "who is the ceo of hack club" without one all the time.
 */
const FACTUAL_Q =
  /\b(who (is|are|was|were)|who'?s|when (is|was|did|does|do)|where (is|are|was)|how (much|many|old|tall|far|long)|what('?s| is| are| was| were) the)\b/i;

/** Greetings shaped like questions that never need the web. */
const SMALL_TALK =
  /\b(what'?s|how'?s|how are)\s+(up|good|poppin|goin|going|new|crackin|ya|u|you)\b|\b(wyd|wassup|sup)\b/i;

/**
 * Cheap gate in front of the classifier below. That classifier is a full
 * model round-trip, and it used to run on literally every reply, so "yo
 * pixo" paid for an entire extra LLM call, in series, before Pixo could
 * even start writing. The overwhelming majority of messages in a Slack
 * channel obviously need no web search, and a regex can tell for free.
 * Anything that looks even vaguely like a lookup still goes to the model.
 */
function mightNeedWeb(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (WEB_HINTS.test(t)) return true;
  if (SMALL_TALK.test(t)) return false;
  return FACTUAL_Q.test(t);
}

export async function extractSearchQuery(messages: string[]): Promise<string | null> {
  if (!process.env.BRAVE_SEARCH_KEY) return null;
  const combined = messages.join("\n");
  if (!mightNeedWeb(combined)) return null;
  try {
    const res = await aiClassify({
      messages: [
        {
          role: "system",
          content:
            "You are a router, not a chat partner. NEVER answer, greet, or talk to the user. If their message needs up-to-date info from the web (current events, news, prices, recent releases, live data, things that change over time), reply with exactly `SEARCH: <query>` where <query> is the ideal web search in English. Otherwise reply with exactly `NONE`. No other output is valid.",
        },
        { role: "user", content: combined },
      ],
      max_tokens: 20,
    });
    const out = res.data.choices?.[0]?.message?.content?.trim();
    // Require the affirmative marker rather than trusting anything that
    // simply isn't a refusal token. This model does not reliably follow the
    // "say SKIP" half of an instruction like this, asked about "yo pixo
    // whats up" it answers the greeting instead, and treating that reply as
    // a query fed whole sentences to Brave and pasted the junk results into
    // Pixo's context as fact. Anything not shaped like SEARCH: is no search.
    const match = out?.match(/^\s*SEARCH\s*:\s*(.+)$/is);
    if (!match) return null;
    const query = match[1].trim().replace(/^["'`]|["'`]$/g, "").split("\n")[0].trim();
    // A real search query is a few keywords. Prose here means the model
    // started chatting again despite the marker.
    if (!query || query.length > 120 || query.split(/\s+/).length > 16) return null;
    return query;
  } catch (e) {
    return null;
  }
}

export type ChimeVerdict = "direct" | "chime" | "skip";

export async function shouldChimeIn(messages: string[]): Promise<ChimeVerdict> {
  const combined = messages.map(resolveUserMentions).join("\n");
  const botIdHint = botIdentity.userId
    ? `The bot's Slack mention is @pixorpheus (ID <@${botIdentity.userId}>). `
    : "";
  try {
    const res = await aiClassify({
      messages: [
        {
          role: "system",
          content: `${botIdHint}You are deciding whether Pixorpheus (a sarcastic Slack bot) should respond. Reply with exactly one word, nothing else.

DIRECT - someone is clearly talking TO the bot. Signs: mentions "pixorpheus", "pix", "pixo", "bot", asks a question in a way that expects the bot to answer, replies directly to something the bot said, or the message is clearly addressed to no one else in the conversation.
CHIME - people are talking among themselves BUT there's a genuinely perfect, funny, or obvious 1-line opening for the bot (rare, only if it's really there)
SKIP - just people chatting between themselves, bot has no business here

When in doubt between DIRECT and CHIME, pick DIRECT. When in doubt between CHIME and SKIP, pick SKIP.`,
        },
        { role: "user", content: combined },
      ],
      max_tokens: 5,
    });
    const word = res.data.choices?.[0]?.message?.content?.trim().toUpperCase().split(/\s/)[0];
    if (word === "DIRECT") return "direct";
    if (word === "CHIME") return "chime";
    return "skip";
  } catch (e) {
    return "skip";
  }
}
