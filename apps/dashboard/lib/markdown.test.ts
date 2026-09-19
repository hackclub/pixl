import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

const IMG = /^<img class="md-img" src="https?:\/\/[^"'\s\[\]]+" alt="[^"<>]*" loading="lazy" \/>$/;
const ANCHOR = /^<a href="https?:\/\/[^"'\s\[\]]+" target="_blank" rel="noreferrer">$/;
const INERT = /<\/?(strong|em|s|code)>/g;

function brokenTags(html: string): string[] {
  const flat = html.replace(INERT, "");
  const starts = flat.match(/<(img|a)\s/g)?.length ?? 0;
  const whole = flat.match(/<(img|a)\s[^>]*>/g) ?? [];
  const bad = whole.filter((t) => !(t.startsWith("<img") ? IMG : ANCHOR).test(t));
  return starts === whole.length ? bad : [...bad, "unterminated tag"];
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  "![", "](", ")", "[", "]", "[[", "]]", "**", "*", "_", "~~", "`", "\n", " ", "> ", "- ", "# ",
  "http://a.b/", "https://x.y/z", "https://a.b/[b", "https://a.b/]", "https://c/onerror=x=1;//",
  '"', "'", "<", ">", "&", "=", "x", "hello", "javascript:alert(1)",
];

describe("renderMarkdown link and image safety", () => {
  test("nested link inside image alt cannot inject attributes", () => {
    const out = renderMarkdown("![[x](http://a.b/i)](https://c/onerror=window.pwn=1;//)");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<[^>]*onerror=/i);
    expect(brokenTags(out)).toEqual([]);
  });

  test("brackets in urls are left as plain text", () => {
    for (const src of ["[a](https://x/[y)", "![a](https://x/y])", "[a](https://x/[y])"]) {
      const out = renderMarkdown(src);
      expect(out).not.toContain("<img");
      expect(out).not.toContain("<a ");
    }
  });

  test("brackets in alt text are left as plain text", () => {
    expect(renderMarkdown("![a[b](https://x/y)")).not.toContain("<img");
  });

  test("plain image and link still render", () => {
    expect(renderMarkdown("![shot](https://i.example/a.png)")).toContain(
      '<img class="md-img" src="https://i.example/a.png" alt="shot" loading="lazy" />',
    );
    expect(renderMarkdown("[docs](https://example.com/x)")).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noreferrer">docs</a>',
    );
  });

  test("linked image badge still renders", () => {
    const out = renderMarkdown("[![build](https://i.example/b.svg)](https://ci.example/run)");
    expect(out).toContain('<a href="https://ci.example/run"');
    expect(out).toContain('<img class="md-img" src="https://i.example/b.svg" alt="build"');
    expect(brokenTags(out)).toEqual([]);
  });

  test("non http urls are never linked", () => {
    expect(renderMarkdown("[a](javascript:alert(1))")).not.toContain("<a ");
  });

  test("random adversarial input never yields a malformed tag", () => {
    const next = rng(20260919);
    for (let i = 0; i < 20000; i++) {
      let src = "";
      for (let n = 1 + Math.floor(next() * 14); n > 0; n--) src += TOKENS[Math.floor(next() * TOKENS.length)];
      const out = renderMarkdown(src);
      expect(brokenTags(out)).toEqual([]);
    }
  });
});
