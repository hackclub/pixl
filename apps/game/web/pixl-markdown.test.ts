import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const lines = readFileSync(join(import.meta.dir, "pixl.js"), "utf8").split("\n");
const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
const escAt = at(/^\s*function esc\(s\)/);
const bbAt = at(/^\s*function bbSafeColor\(/);
const endAt = at(/^\s*function timeAgo\(/);
const { bbcode, markdown } = new Function(
  `${lines.slice(escAt, escAt + 5).join("\n")}\n${lines.slice(bbAt, endAt).join("\n")}\nreturn { bbcode, markdown };`,
)() as { bbcode: (s: string) => string; markdown: (s: string) => string };

const MD_IMG =
  /^<img class="md-img" src="https?:\/\/[^"'\s\[\]]+" alt="[^"<>]*" loading="lazy" onerror="this\.remove\(\)">$/;
const BB_IMG =
  /^<img class="bb-img" src="https?:\/\/[^"'\s\[\]]+" alt="" loading="lazy" onerror="this\.remove\(\)">$/;
const ANCHOR = /^<a href="https?:\/\/[^"'\s\[\]]+" target="_blank" rel="noopener">$/;
const INERT = /<\/?(strong|em|s|code|b|i|u)>/g;

function brokenTags(html: string): string[] {
  const flat = html.replace(INERT, "");
  const starts = flat.match(/<(img|a)\s/g)?.length ?? 0;
  const whole = flat.match(/<(img|a)\s[^>]*>/g) ?? [];
  const bad = whole.filter((t) => !(t.startsWith("<a") ? ANCHOR : t.includes("bb-img") ? BB_IMG : MD_IMG).test(t));
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

const MD_TOKENS = [
  "![", "](", ")", "[", "]", "[[", "]]", "**", "*", "_", "~~", "`", "\n", " ", "> ", "- ", "# ",
  "http://a.b/", "https://x.y/z", "https://a.b/[b", "https://a.b/]", "https://c/onerror=x=1;//",
  '"', "'", "<", ">", "&", "=", "x", "hello", "javascript:alert(1)",
];

const BB_TOKENS = [
  "[url]", "[/url]", "[url=", "[url=https://a.b/]", "[img]", "[/img]", "[img=", "[b]", "[/b]", "[i]", "[/i]",
  "[color=red]", "[/color]", "[center]", "[/center]", "[code]", "[/code]", "]", "[", "=",
  "http://a.b/", "https://x.y/z", "https://a[", "https://c/onerror=x=1;//", '"', "'", "<", ">", "x", " ",
];

describe("Pixl.markdown link and image safety", () => {
  test("nested link inside image alt cannot inject attributes", () => {
    const out = markdown("![[x](http://a.b/i)](https://c/onerror=window.pwn=1;//)");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<[^>]*onerror=window/i);
    expect(brokenTags(out)).toEqual([]);
  });

  test("brackets in urls are left as plain text", () => {
    for (const src of ["[a](https://x/[y)", "![a](https://x/y])", "[a](https://x/[y])"]) {
      const out = markdown(src);
      expect(out).not.toContain("<img");
      expect(out).not.toContain("<a ");
    }
  });

  test("plain image and link still render", () => {
    expect(markdown("![shot](https://i.example/a.png)")).toContain(
      '<img class="md-img" src="https://i.example/a.png" alt="shot" loading="lazy" onerror="this.remove()">',
    );
    expect(markdown("[docs](https://example.com/x)")).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noopener">docs</a>',
    );
  });

  test("linked image badge still renders", () => {
    const out = markdown("[![build](https://i.example/b.svg)](https://ci.example/run)");
    expect(out).toContain('<a href="https://ci.example/run"');
    expect(out).toContain('<img class="md-img" src="https://i.example/b.svg" alt="build"');
    expect(brokenTags(out)).toEqual([]);
  });

  test("random adversarial input never yields a malformed tag", () => {
    const next = rng(20260919);
    for (let i = 0; i < 20000; i++) {
      let src = "";
      for (let n = 1 + Math.floor(next() * 14); n > 0; n--) src += MD_TOKENS[Math.floor(next() * MD_TOKENS.length)];
      expect(brokenTags(markdown(src))).toEqual([]);
    }
  });
});

describe("Pixl.bbcode link and image safety", () => {
  test("nested url tags never leave an unterminated anchor", () => {
    const out = bbcode("[url=https://a[url=https://b/]x[/url].c/]y[/url]");
    expect(brokenTags(out)).toEqual([]);
  });

  test("plain url and img tags still render", () => {
    expect(bbcode("[url=https://example.com/x]docs[/url]")).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noopener">docs</a>',
    );
    expect(bbcode("[img]https://i.example/a.png[/img]")).toContain('<img class="bb-img" src="https://i.example/a.png"');
  });

  test("random adversarial input never yields a malformed tag", () => {
    const next = rng(20260920);
    for (let i = 0; i < 20000; i++) {
      let src = "";
      for (let n = 1 + Math.floor(next() * 14); n > 0; n--) src += BB_TOKENS[Math.floor(next() * BB_TOKENS.length)];
      expect(brokenTags(bbcode(src))).toEqual([]);
    }
  });
});
