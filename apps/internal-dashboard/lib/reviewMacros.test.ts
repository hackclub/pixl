import { describe, expect, test } from "bun:test";
import {
  REVIEW_MACROS,
  expandMacro,
  hasUnfilledMacroPlaceholder,
  customReviewMacroError,
  normalizeCustomReviewMacro,
  parseCustomReviewMacros,
} from "./reviewMacros";

const AI = REVIEW_MACROS.find((m) => m.trigger === "/ai")!;
const FRAUD = REVIEW_MACROS.find((m) => m.trigger === "/fraud")!;
const README_AI = REVIEW_MACROS.find((m) => m.trigger === "/readmeai")!;
const BAD_README = REVIEW_MACROS.find((m) => m.trigger === "/badreadme")!;

describe("expandMacro", () => {
  test("/ai on its own becomes the excessive-AI message", () => {
    const out = expandMacro("/ai", 3);
    expect(out?.value).toBe(AI.text);
    expect(out?.caret).toBe(AI.text.length);
  });

  test("works after existing text and keeps what comes after the caret", () => {
    const out = expandMacro("Thanks for shipping!\n/ai and more", 24);
    expect(out?.value).toBe(`Thanks for shipping!\n${AI.text} and more`);
    expect(out?.caret).toBe("Thanks for shipping!\n".length + AI.text.length);
  });

  test("is case-insensitive", () => {
    expect(expandMacro("/AI", 3)?.value).toBe(AI.text);
  });

  test("does not fire inside a URL or glued to a word", () => {
    expect(expandMacro("see https://example.dev/ai", 26)).toBeNull();
    expect(expandMacro("repo/ai", 7)).toBeNull();
  });

  test("does nothing for ordinary text or a half-typed trigger", () => {
    expect(expandMacro("Great work", 10)).toBeNull();
    expect(expandMacro("/a", 2)).toBeNull();
    expect(expandMacro("", 0)).toBeNull();
  });

  test("only looks at the text before the caret", () => {
    expect(expandMacro("hello /ai", 5)).toBeNull();
  });
});

describe("/fraud", () => {
  test("becomes the fraud squad ban message and puts the caret after it", () => {
    const out = expandMacro("/fraud", 6);
    expect(out?.value).toBe("This project was banned by the fraud squad. Please check fraud.hackclub.com ");
    expect(out?.caret).toBe(out!.value.length);
  });

  test("expands mid-note and is not mistaken for /ai", () => {
    const out = expandMacro("Sorry. /fraud", 13);
    expect(out?.value).toBe(`Sorry. ${FRAUD.text}`);
    expect(expandMacro("/fra", 4)).toBeNull();
  });
});

describe("/readmeai", () => {
  test("becomes the AI-generated README message and puts the caret after it", () => {
    const out = expandMacro("/readmeai", 9);
    expect(out?.value).toBe(README_AI.text);
    expect(out?.caret).toBe(README_AI.text.length);
  });

  test("expands mid-note and is case-insensitive", () => {
    const out = expandMacro("Hey! /READMEAI", 14);
    expect(out?.value).toBe(`Hey! ${README_AI.text}`);
    expect(expandMacro("/readme", 7)).toBeNull();
  });
});

describe("/badreadme", () => {
  test("becomes the missing-requirements README message and puts the caret at insertion point without placeholder X", () => {
    const out = expandMacro("/badreadme", 10);
    expect(out?.value).toBe(BAD_README.text);
    expect(out?.value).not.toContain("missing X");
    expect(out?.caret).toBe(BAD_README.caretOffset ?? BAD_README.text.length);
  });

  test("expands mid-note and is case-insensitive", () => {
    const out = expandMacro("Hey! /BADREADME", 15);
    expect(out?.value).toBe(`Hey! ${BAD_README.text}`);
    expect(out?.caret).toBe("Hey! ".length + (BAD_README.caretOffset ?? BAD_README.text.length));
    expect(expandMacro("/badread", 8)).toBeNull();
  });
});

describe("the /readmeai message", () => {
  test("fits the 1000 character player note limit with room to spare", () => {
    expect(README_AI.text.length).toBeLessThan(700);
  });

  test("has no em dashes", () => {
    expect(README_AI.text).not.toContain("—");
  });
});

describe("the /badreadme message", () => {
  test("fits the 1000 character player note limit with room to spare", () => {
    expect(BAD_README.text.length).toBeLessThan(700);
  });

  test("has no em dashes", () => {
    expect(BAD_README.text).not.toContain("—");
  });
});

describe("the /ai message", () => {
  test("fits the 1000 character player note limit with room to spare", () => {
    expect(AI.text.length).toBeLessThan(700);
  });

  test("has no em dashes", () => {
    expect(AI.text).not.toContain("—");
  });
});

describe("hasUnfilledMacroPlaceholder", () => {
  test("catches empty expanded /badreadme without edit", () => {
    expect(hasUnfilledMacroPlaceholder(BAD_README.text)).toBe(true);
    expect(hasUnfilledMacroPlaceholder("...missing ) :(...")).toBe(true);
    expect(hasUnfilledMacroPlaceholder("...missing  ) :(...")).toBe(true);
  });

  test("catches legacy missing X placeholder", () => {
    expect(hasUnfilledMacroPlaceholder("noticed your readme is missing X :(")).toBe(true);
  });

  test("passes when requirements are filled in or note is normal", () => {
    expect(hasUnfilledMacroPlaceholder(BAD_README.text.replace("missing ) :(", "missing setup instructions) :("))).toBe(false);
    expect(hasUnfilledMacroPlaceholder("Looks great, just need to add screenshots.")).toBe(false);
    expect(hasUnfilledMacroPlaceholder("")).toBe(false);
  });
});

describe("custom reviewer macros", () => {
  const custom = { trigger: "/nicework", label: "Encouragement", text: "Nice work! Keep building." };

  test("expands a custom macro and leaves built-ins available", () => {
    const macros = [...REVIEW_MACROS, custom];
    expect(expandMacro("/NICEWORK", 9, macros)?.value).toBe(custom.text);
    expect(expandMacro("Hello /nicework!", 15, macros)?.value).toBe(`Hello ${custom.text}!`);
    expect(expandMacro("/ai", 3, macros)?.value).toBe(AI.text);
  });

  test("does not expand a template that would be silently truncated by the server", () => {
    const macros = [...REVIEW_MACROS, custom];
    const note = `${"x".repeat(995)} /nicework`;
    expect(expandMacro(note, note.length, macros)).toBeNull();
    expect(expandMacro("/nicework", 9, macros)?.value).toBe(custom.text);
  });

  test("normalizes triggers and keeps message contents", () => {
    expect(normalizeCustomReviewMacro({ trigger: " /NICEWORK ", label: " Great ", text: " Hello! " }))
      .toEqual({ trigger: "/nicework", label: "Great", text: "Hello!" });
  });

  test("rejects malformed triggers, reserved names and early-expansion prefix conflicts", () => {
    expect(customReviewMacroError({ ...custom, trigger: "nice" }, [])).toBeTruthy();
    expect(customReviewMacroError({ ...custom, trigger: "/ai" }, [])).toContain("conflicts");
    expect(customReviewMacroError({ ...custom, trigger: "/a" }, [])).toContain("conflicts");
    expect(customReviewMacroError({ ...custom, trigger: "/aiextra" }, [])).toContain("conflicts");
    expect(customReviewMacroError({ ...custom, trigger: "/niceworkmore" }, [custom])).toContain("conflicts");
    expect(customReviewMacroError({ ...custom, trigger: "/nicely" }, [custom])).toBeNull();
    expect(customReviewMacroError({ ...custom, trigger: "/nicework" }, [custom], "/nicework")).toBeNull();
  });

  test("validates message/name length and quantity", () => {
    expect(customReviewMacroError({ ...custom, text: "x".repeat(1001) }, [])).toBeTruthy();
    expect(customReviewMacroError({ ...custom, text: " " }, [])).toBeTruthy();
    expect(customReviewMacroError({ ...custom, label: "x".repeat(61) }, [])).toBeTruthy();
    const full = Array.from({ length: 20 }, (_, n) => ({
      trigger: `/custom${n}`, label: "Custom", text: "Hi!",
    }));
    expect(customReviewMacroError(custom, full)).toContain("20");
  });

  test("parses account settings defensively and never overrides built-ins", () => {
    const input: unknown = [
      { trigger: " /NICEWORK ", label: " Good job ", text: " Awesome! " },
      { trigger: "/nicework", label: "Duplicate", text: "No" },
      { trigger: "/ai", label: "Shadow", text: "No" },
      { trigger: "/nice", label: "Early conflict", text: "No" },
      { trigger: "/another", label: "Another", text: "Thanks" },
      { trigger: "/bad", label: "Missing text", text: null },
      "wrong type",
    ];
    expect(parseCustomReviewMacros(input)).toEqual([
      { trigger: "/nicework", label: "Good job", text: "Awesome!" },
      { trigger: "/another", label: "Another", text: "Thanks" },
    ]);
    expect(parseCustomReviewMacros({ trigger: "/nicework" })).toEqual([]);
    expect(parseCustomReviewMacros(null)).toEqual([]);
  });

  test("rejects oversized raw action inputs before normalization", () => {
    expect(parseCustomReviewMacros([{ ...custom, text: " ".repeat(500_000) + custom.text }])).toEqual([]);
    expect(parseCustomReviewMacros([{ ...custom, trigger: " ".repeat(200) + custom.trigger }])).toEqual([]);
    expect(parseCustomReviewMacros([{ ...custom, label: " ".repeat(200) + custom.label }])).toEqual([]);
  });

  test("never retains extra properties supplied to a Server Action", () => {
    const input = [{ ...custom, slackId: "another-reviewer", role: "owner", injected: "__proto__" }];
    expect(parseCustomReviewMacros(input)).toEqual([custom]);
  });

  test("HTML and script-like text is data, not executable markup", () => {
    const text = '<img src=x onerror="alert(1)"><script>doBadThing()</script>';
    const parsed = parseCustomReviewMacros([{ ...custom, text }]);
    expect(parsed[0]?.text).toBe(text);
    expect(expandMacro("/nicework", 9, [...REVIEW_MACROS, ...parsed])?.value).toBe(text);
  });
});
