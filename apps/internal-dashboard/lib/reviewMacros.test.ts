import { describe, expect, test } from "bun:test";
import { REVIEW_MACROS, expandMacro } from "./reviewMacros";

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
  test("becomes the missing-requirements README message and puts the caret after it", () => {
    const out = expandMacro("/badreadme", 10);
    expect(out?.value).toBe(BAD_README.text);
    expect(out?.caret).toBe(BAD_README.text.length);
  });

  test("expands mid-note and is case-insensitive", () => {
    const out = expandMacro("Hey! /BADREADME", 15);
    expect(out?.value).toBe(`Hey! ${BAD_README.text}`);
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
