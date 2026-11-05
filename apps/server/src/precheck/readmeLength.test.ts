import { describe, expect, test } from "bun:test";
import { checkReadmeLength, MIN_README_WORDS, readmeProseWordCount } from "./readmeLength";

const url = "https://github.com/example/project";
const words = (n: number) => Array(n).fill("documented").join(" ");

describe("readmeProseWordCount", () => {
  test("ignores Markdown formatting, images, badges, links and code blocks", () => {
    const md = [
      "# Project",
      "![badge](https://img.shields.io/x)",
      "![Screenshot](preview.png)",
      "[setup guide](https://example.com)",
      "```js",
      "const filler = '" + words(300) + "'",
      "```",
      "<!-- " + words(300) + " -->",
      "Some **actual** text to read.",
    ].join("\n");
    expect(readmeProseWordCount(md)).toBe(8);
  });

  test("counts Unicode prose and ignores standalone numeric values", () => {
    expect(readmeProseWordCount("こんにちは世界 Привет мир")).toBeGreaterThanOrEqual(3);
    expect(readmeProseWordCount("Step 1: Build 123 456 now")).toBe(3);
  });

  test("enforces the exact 200 word boundary", () => {
    expect(readmeProseWordCount(words(199))).toBe(199);
    expect(readmeProseWordCount(words(200))).toBe(200);
  });

  test("does not count inline code, HTML comments or bare URLs", () => {
    expect(readmeProseWordCount("Install `" + words(200) + "` then visit https://example.com/installation")).toBe(2);
  });
});

describe("checkReadmeLength", () => {
  test("passes a README with exactly 200 prose words", async () => {
    const r = await checkReadmeLength(url, {
      files: async () => ["README.md", "index.ts"],
      raw: async () => words(200),
    });
    expect(r).toEqual({ status: "passed", words: 200, minWords: MIN_README_WORDS });
  });

  test("blocks 199 words even when it exceeds 200 characters", async () => {
    const r = await checkReadmeLength(url, {
      files: async () => ["README.md"],
      raw: async () => words(199),
    });
    expect(r).toEqual({ status: "too_short", words: 199, minWords: MIN_README_WORDS });
  });

  test("blocks short READMEs with a word count", async () => {
    const r = await checkReadmeLength(url, {
      files: async () => ["README.md"],
      raw: async () => "# Tiny\nHi",
    });
    expect(r).toEqual({ status: "too_short", words: 2, minWords: MIN_README_WORDS });
  });

  test("blocks a known missing README", async () => {
    const r = await checkReadmeLength(url, { files: async () => ["main.ts"] });
    expect(r).toEqual({ status: "missing", words: 0, minWords: MIN_README_WORDS });
  });

  test("does not confuse fetch failures with a missing README", async () => {
    expect((await checkReadmeLength(url, { files: async () => null })).status).toBe("unavailable");
    expect((await checkReadmeLength(url, { files: async () => ["README.md"], raw: async () => null })).status).toBe("unavailable");
  });

  test("does not fetch arbitrary Git hosts", async () => {
    expect((await checkReadmeLength("https://gitlab.com/example/project")).status).toBe("unsupported");
  });

  test("respects the GitHub project subdirectory", async () => {
    const r = await checkReadmeLength("https://github.com/example/repo/tree/main/sub", {
      files: async (ref) => {
        expect(ref.path).toBe("sub");
        return ["README.md"];
      },
      raw: async (ref, path) => {
        expect(ref.path).toBe("sub");
        expect(path).toBe("README.md");
        return words(200);
      },
    });
    expect(r.status).toBe("passed");
  });
});
