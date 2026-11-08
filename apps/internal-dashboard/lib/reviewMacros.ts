// Text macros for the review form's "note to the player": type a trigger like
// /ai and it turns into the canned message. To add one, add an entry below, the
// form and its hint pick it up automatically.
export interface ReviewMacro {
  /** What the reviewer types, starting with "/". Matched case-insensitively. */
  trigger: string;
  /** Short name shown in the hint under the note field. */
  label: string;
  /** The text that replaces the trigger. */
  text: string;
  /** Optional caret position within text after expansion. Defaults to text.length. */
  caretOffset?: number;
}

const BAD_README_PREFIX =
  "Hiii :hii: !! cool project, super tuff :yay: !! but i noticed your readme doesnt meet all the requirements yet (like for example missing ";

export const REVIEW_MACROS: readonly ReviewMacro[] = [
  {
    trigger: "/ai",
    label: "Rejection for excessive AI use",
    text:
      "Hey, this project is being rejected as it violates our policy against excessive AI use. " +
      "At Pixl and at Hack Club, we want to see your projects reflect your own growth and learning as a person, " +
      "not how well an AI can code.\n" +
      "To avoid rejections in the future, try to limit your AI usage to a minimum. A good rule of thumb: consider " +
      "whether you could make your project again, but without AI. The answer should always be yes.\n\n" +
      "Feel free to resubmit another project to Pixl!",
  },
  {
    trigger: "/fraud",
    label: "Banned by the fraud squad",
    text: "This project was banned by the fraud squad. Please check fraud.hackclub.com ",
  },
  {
    trigger: "/readmeai",
    label: "AI-generated README",
    text:
      "heyy :hii:, i like your project, very tuff!! however your readme looks ai generated right now :(Could you please make one yourself from scratch?? thanks!! here's a handy template you can use for reference: https://gist.github.com/FaizeenHoque/0709576cc598721df07fb62d2430e6fe\n" +
      "good luck! :yay2:",
  },
  {
    trigger: "/badreadme",
    label: "README missing requirements",
    text:
      BAD_README_PREFIX +
      ") :( Could you please edit it so it does?? thanks!! here's a handy template you can use for reference: https://gist.github.com/FaizeenHoque/0709576cc598721df07fb62d2430e6fe\n" +
      "good luck! :yay2:",
    caretOffset: BAD_README_PREFIX.length,
  },
];

// Personal reviewer shortcuts are stored in staff_settings. Keep these limits
// aligned with the 1000-character player-note limit and validate on the server.
export type CustomReviewMacro = Pick<ReviewMacro, "trigger" | "label" | "text">;
export const MAX_CUSTOM_REVIEW_MACROS = 20;
export const MAX_REVIEW_NOTE_LENGTH = 1000;
export const MAX_CUSTOM_MACRO_TEXT_LENGTH = MAX_REVIEW_NOTE_LENGTH;

export function normalizeCustomReviewMacro(macro: CustomReviewMacro): CustomReviewMacro {
  return {
    trigger: macro.trigger.trim().toLowerCase(),
    label: macro.label.trim(),
    text: macro.text.trim(),
  };
}

/** Prefix collisions would expand too early while someone types a longer command. */
export function customReviewMacroError(
  input: CustomReviewMacro,
  customMacros: readonly CustomReviewMacro[],
  editingTrigger?: string,
): string | null {
  const macro = normalizeCustomReviewMacro(input);
  if (!/^\/[a-z][a-z0-9_-]{0,23}$/.test(macro.trigger))
    return "Use / followed by 1–24 letters, numbers, _ or - (starting with a letter).";
  if (!macro.label || macro.label.length > 60) return "Give the macro a name (1–60 characters).";
  if (!macro.text || macro.text.length > MAX_CUSTOM_MACRO_TEXT_LENGTH)
    return "Macro text must be 1–1000 characters.";
  const remaining = customMacros.filter((m) => m.trigger.toLowerCase() !== editingTrigger?.toLowerCase());
  if (!editingTrigger && remaining.length >= MAX_CUSTOM_REVIEW_MACROS)
    return `You can save up to ${MAX_CUSTOM_REVIEW_MACROS} custom macros.`;
  const collision = [...REVIEW_MACROS, ...remaining].find((m) => {
    const existing = m.trigger.toLowerCase();
    return existing.startsWith(macro.trigger) || macro.trigger.startsWith(existing);
  });
  if (collision) return `/${macro.trigger.slice(1)} conflicts with ${collision.trigger}; choose a different shortcut.`;
  return null;
}

/** Untrusted JSON from staff_settings: ignore invalid entries and never override built-ins. */
export function parseCustomReviewMacros(raw: unknown): CustomReviewMacro[] {
  if (!Array.isArray(raw)) return [];
  const macros: CustomReviewMacro[] = [];
  for (const item of raw) {
    if (macros.length >= MAX_CUSTOM_REVIEW_MACROS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.trigger !== "string" || typeof r.label !== "string" || typeof r.text !== "string") continue;
    // Avoid processing multi-megabyte strings from a forged Server Action request.
    // Allow some trim padding, but bound every field BEFORE allocating trimmed copies.
    if (r.trigger.length > 64 || r.label.length > 128 || r.text.length > 2048) continue;
    const macro = normalizeCustomReviewMacro({ trigger: r.trigger, label: r.label, text: r.text });
    if (!customReviewMacroError(macro, macros)) macros.push(macro);
  }
  return macros;
}

/**
 * If the text right before the caret is a macro trigger (alone, not glued to
 * the end of another word or a URL like https://x.dev/ai), returns the text with
 * the trigger replaced by the macro and where the caret should land. Otherwise
 * null. The caller decides when to ask: only after something was typed or
 * pasted, so deleting back down to "/ai" never expands it.
 */
export function expandMacro(
  value: string,
  caret: number,
  macros: readonly ReviewMacro[] = REVIEW_MACROS,
): { value: string; caret: number } | null {
  const before = value.slice(0, caret);
  const lower = before.toLowerCase();
  for (const macro of macros) {
    if (!lower.endsWith(macro.trigger.toLowerCase())) continue;
    const start = before.length - macro.trigger.length;
    if (start > 0 && !/\s/.test(before[start - 1])) continue;
    const expanded = before.slice(0, start) + macro.text + value.slice(caret);
    // reviewProject caps player-facing notes at 1000 chars. Never silently insert
    // a macro whose text would be cut off when the reviewer sends the verdict.
    if (expanded.length > MAX_REVIEW_NOTE_LENGTH) return null;
    return {
      value: expanded,
      caret: start + (macro.caretOffset ?? macro.text.length),
    };
  }
  return null;
}

/**
 * Detects if a reviewer expanded /badreadme without specifying the missing
 * requirements (leaving "missing ) :(" or the legacy "missing X").
 */
export function hasUnfilledMacroPlaceholder(text: string): boolean {
  return /missing\s*(?:X\b|\)\s*:\()/i.test(text);
}
