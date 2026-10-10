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
}

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
];

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
    return {
      value: before.slice(0, start) + macro.text + value.slice(caret),
      caret: start + macro.text.length,
    };
  }
  return null;
}
