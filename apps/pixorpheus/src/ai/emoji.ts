/**
 * Pull the "REACT: :emoji:" directive out of an AI reply. Tolerant of the
 * model's formatting drift: missing colons, lowercase "react:", trailing
 * whitespace/newlines, or a reply that is ONLY the REACT line. Anchored to
 * its own line so normal text mentioning "REACT" is left alone.
 *
 * Canonical custom emoji names (must match the CUSTOM EMOJIS list in the
 * persona system prompt exactly). The prompt mixes hyphens and underscores
 * across names (:yay-gay: vs :blobhaj_party: vs :eyes_wtf:), which the
 * model regularly mixes up (e.g. writes :yay_gay: instead of :yay-gay:).
 * Rather than trust the model to get the exact separator right, normalize
 * by matching on a punctuation-insensitive key and rewriting to the real
 * name — for both the REACT: line and any :emoji: written inline in the
 * reply text.
 */
export const CUSTOM_EMOJIS = [
  "wiltedrose",
  "yay",
  "loll",
  "sad-pf",
  "skulk",
  "noooovanish",
  "angy",
  "yesyes",
  "blobhaj_party",
  "shocked",
  "upvote",
  "lets-fucking-gooo",
  "stuck_out_tongue_closed_eyes",
  "huh3d",
  "thumbs-up",
  "3c",
  "byee",
  "hii",
  "nono",
  "hehehe",
  "awww",
  "alibaba-admire",
  "alibaba-grin",
  "cryign",
  "heavysob",
  "brokenheart",
  "nyan",
  "cat-gun",
  "pixo-shrug",
  "sob-pray",
  "agadance",
  "cat-woah",
  "cat-heart",
  "communist",
  "eyes_wtf",
  "eyes_shaking",
  "eyes-out-of-head",
  "orpheus-love",
  "orpheus-baguette",
  "orphanage",
  "orpheus-explode",
  "hyper-dino-wave",
  "pepedyingoflaughter",
  "pet-gabin",
  "pet-ridit",
  "pet-maxx",
  "yapa",
  "yay-gay",
  "wagay",
  "gay-flag",
  "bhjflag_gay",
  "spinny_cat_gay",
  "1984",
] as const;

const emojiLooseKey = (name: string) => name.toLowerCase().replace(/[-_]/g, "");
const CUSTOM_EMOJI_BY_LOOSE_KEY = new Map<string, string>(
  CUSTOM_EMOJIS.map((name) => [emojiLooseKey(name), name]),
);

/**
 * Standard edit-distance, used as a fallback when the model doesn't just mix
 * up -/_ (already handled above) but flat-out typos a name — e.g. writes
 * :huhj3d: instead of :huh3d: (an extra letter, not a separator swap).
 */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function fixEmojiName(name: string): string {
  const key = emojiLooseKey(name);
  const exact = CUSTOM_EMOJI_BY_LOOSE_KEY.get(key);
  if (exact) return exact;

  // Fuzzy fallback: nearest custom emoji by edit distance, only if it's a
  // close typo (not just two names that happen to share a few letters).
  let best: string | null = null;
  let bestDist = Infinity;
  for (const canonical of CUSTOM_EMOJIS) {
    const canonicalKey = emojiLooseKey(canonical);
    const dist = levenshtein(key, canonicalKey);
    if (dist < bestDist) {
      bestDist = dist;
      best = canonical;
    }
  }
  const threshold = best && emojiLooseKey(best).length > 5 ? 2 : 1;
  return best && bestDist <= threshold ? best : name;
}

export function fixInlineEmojiMentions(text: string): string {
  return text.replace(/:([a-zA-Z0-9_+-]+):/g, (match, name) => {
    const fixed = fixEmojiName(name);
    return fixed === name ? match : `:${fixed}:`;
  });
}

export interface ExtractedReaction {
  text: string | null;
  emoji: string | null;
}

export function extractReaction(raw: string | null | undefined): ExtractedReaction {
  if (!raw || typeof raw !== "string") return { text: raw ?? null, emoji: null };
  let emoji: string | null = null;
  const text = raw
    .replace(/(?:^|\n)[ \t]*REACT:[ \t]*:?([a-zA-Z0-9_+-]+):?[ \t]*(?=\n|$)/gi, (_, name) => {
      emoji = emoji || fixEmojiName(name);
      return "";
    })
    .trim();
  return { text: fixInlineEmojiMentions(text), emoji };
}
