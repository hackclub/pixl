import { describe, expect, test } from "bun:test";
import { checkReadmeLength, MIN_README_CHARS, readmeProseLength } from "./readmeLength";

const url = "https://github.com/example/project";
const good = "A useful project that explains its purpose and how it works in enough detail for somebody else to try it. ".repeat(4);

describe("readmeProseLength", () => {
  test("ignores Markdown formatting, images, badges, links and code blocks", () => {
    const md = [
      "# Project",
      "![badge](https://img.shields.io/x)",
      "![Screenshot](preview.png)",
      "[setup guide](https://example.com)",
      "```js",
      "const filler = '" + "x".repeat(500) + "'",
      "```",
      "<!-- " + "secret".repeat(100) + " -->",
    ].join("\n");
    expect(readmeProseLength(md)).toBeLessThan(30);
  });

  test("counts Unicode prose as meaningful content", () => {
    expect(readmeProseLength("こんにちは世界 Привет мир")).toBeGreaterThan(10);
  });
});

describe("checkReadmeLength", () => {
  test("passes a detailed README", async () => {
    const r = await checkReadmeLength(url, {
      files: async () => ["README.md", "index.ts"],
      raw: async () => good,
    });
    expect(r.status).toBe("passed");
    expect(r.chars).toBeGreaterThanOrEqual(MIN_README_CHARS);
  });

  test("blocks short READMEs with a count", async () => {
    const r = await checkReadmeLength(url, {
      files: async () => ["README.md"],
      raw: async () => "# Tiny\nHi",
    });
    expect(r).toEqual({ status: "too_short", chars: 6, minChars: MIN_README_CHARS });
  });

  test("blocks a known missing README", async () => {
    const r = await checkReadmeLength(url, { files: async () => ["main.ts"] });
    expect(r.status).toBe("missing");
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
        return good;
      },
    });
    expect(r.status).toBe("passed");
  });
});
