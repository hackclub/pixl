import { describe, expect, test } from "bun:test";
import { countJournalImages, journalImagesNeeded, journalTextLength } from "./journalRules.js";

const image = (name: string) => `![screenshot](https://cdn.hackclub.com/${"a".repeat(80)}/${name}.png)`;

describe("journalTextLength", () => {
  test("does not count image embeds toward the writing minimum", () => {
    expect(image("one").length).toBeGreaterThan(100);
    expect(journalTextLength(image("one"))).toBe(0);
  });

  test("counts only the written text around images", () => {
    const content = `Built the save system today.\n\n${image("one")}`;
    expect(journalTextLength(content)).toBe("Built the save system today.".length);
  });

  test("a text-only entry is unaffected", () => {
    expect(journalTextLength("  Built the save system today.  ")).toBe("Built the save system today.".length);
  });
});

describe("journal image rules", () => {
  test("images still count toward the image requirement", () => {
    expect(countJournalImages(`${image("one")} ${image("two")}`)).toBe(2);
    expect(journalImagesNeeded(0)).toBe(1);
    expect(journalImagesNeeded(4)).toBe(1);
    expect(journalImagesNeeded(4.1)).toBe(2);
    expect(journalImagesNeeded(8)).toBe(2);
  });
});
