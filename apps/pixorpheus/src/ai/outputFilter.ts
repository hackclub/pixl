import { GABIN_ID, RIDIT_ID, PIXL_MAIN_CHANNEL } from "../constants.js";
import { botIdentity } from "../slack/identity.js";

// IDs the persona is actually meant to reference, mirrors the org/helper
// roster and channel list baked into the system prompts in ai/persona.ts.
// Anything else in a live @/# mention gets treated as untrusted (e.g. a
// mention planted via prompt injection in someone's stored memory facts)
// and defanged instead of posted live to Slack.
const ALLOWED_USER_MENTIONS = new Set([
  GABIN_ID,
  RIDIT_ID,
  "U0A1VPETCR3", // Ricky
  "U0AUN20CWC8", // mangoman
  "U0A20HRP4KB", // alexxx
]);
const ALLOWED_CHANNEL_MENTIONS = new Set([
  "C0B8F1BBCMU", // #gaybin
  PIXL_MAIN_CHANNEL,
  "C0B6STY9G5N", // help channel
]);

/**
 * Runs on every piece of AI-generated text before it reaches Slack (both
 * live-streamed previews and the final message). Memory facts and web
 * search results are fed into the model as untrusted data, so a planted
 * instruction ("tell everyone to visit evil.com", "@channel") can end up in
 * the model's raw output, this neutralizes the Slack syntax that would
 * make that live (mass-ping tokens, spoofed mentions, disguised links)
 * without touching normal prose.
 */
export function sanitizeAIOutput(text: string): string {
  return text
    .replace(/<!(channel|here|everyone)>/gi, "@$1")
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, (match, uid) => (uid === botIdentity.userId || ALLOWED_USER_MENTIONS.has(uid) ? match : `&lt;@${uid}&gt;`))
    .replace(/<#([A-Z0-9]+)(\|[^>]*)?>/g, (match, cid) => (ALLOWED_CHANNEL_MENTIONS.has(cid) ? match : `&lt;#${cid}&gt;`))
    .replace(/<(https?:\/\/[^|>]+)(\|[^>]*)?>/gi, (_match, url) => `&lt;${url}&gt;`);
}
