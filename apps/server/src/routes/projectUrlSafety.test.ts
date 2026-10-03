import { expect, test } from "bun:test";
import { normalizeProjectUrl, MAX_DEMO_URL_LENGTH } from "./projectUrlSafety.js";

const DANGEROUS_URLS = [
  "javascript://alert(1)",
  "javascript://%0aalert(1)",
  "JaVaScRiPt://alert(1)",
  "data://text/html,<script>alert(1)</script>",
  "vbscript://alert(1)",
  "file:///etc/passwd",
  "file://C:/Windows/System32",
];

for (const url of DANGEROUS_URLS) {
  test(`rejects dangerous scheme: ${url}`, () => {
    expect(normalizeProjectUrl(url)).toEqual({ ok: false });
  });
}

// These carry a "dangerous-looking" word but never actually get a scheme (no
// "://"), so ensureProtocol's successor treats them as ordinary scheme-less
// text and prepends https:// - same as any other garbage placeholder text a
// player might type. The result is an inert, non-executable string; it isn't
// a security concern that it round-trips instead of being rejected outright.
const SCHEMELESS_LOOKALIKES: [string, string][] = [
  ["javascript:alert(1)", "https://javascript:alert(1)"],
  ["data:text/html,<script>alert(1)</script>", "https://data:text/html,<script>alert(1)</script>"],
  ["vbscript:alert(1)", "https://vbscript:alert(1)"],
];

for (const [input, expected] of SCHEMELESS_LOOKALIKES) {
  test(`neutralizes scheme-less lookalike: ${input}`, () => {
    expect(normalizeProjectUrl(input)).toEqual({ ok: true, url: expected });
  });
}

const LEGITIMATE_URLS: [string, string][] = [
  ["https://example.com", "https://example.com"],
  ["http://example.com", "http://example.com"],
  ["github.com/user/repo", "https://github.com/user/repo"],
  ["https://github.com/user/repo", "https://github.com/user/repo"],
  ["example.com:8080/path", "https://example.com:8080/path"],
  ["localhost:3000/game", "https://localhost:3000/game"],
  ["  https://example.com  ", "https://example.com"],
];

for (const [input, expected] of LEGITIMATE_URLS) {
  test(`accepts and normalizes legitimate URL: ${input}`, () => {
    expect(normalizeProjectUrl(input)).toEqual({ ok: true, url: expected });
  });
}

test("passes through non-URL placeholder text for ship-time reachability checks to catch", () => {
  expect(normalizeProjectUrl("coming soon")).toEqual({ ok: true, url: "https://coming soon" });
});

test("empty/blank input normalizes to an empty string, not an error", () => {
  expect(normalizeProjectUrl("")).toEqual({ ok: true, url: "" });
  expect(normalizeProjectUrl("   ")).toEqual({ ok: true, url: "" });
  expect(normalizeProjectUrl(null)).toEqual({ ok: true, url: "" });
  expect(normalizeProjectUrl(undefined)).toEqual({ ok: true, url: "" });
});

test("truncates to 500 characters like the old ensureProtocol did", () => {
  const long = "https://example.com/" + "a".repeat(600);
  const result = normalizeProjectUrl(long);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.url.length).toBe(500);
});

test("a higher maxLength lets long links like strudel.cc through, still capped", () => {
  const long = "https://strudel.cc/#" + "a".repeat(9000);
  const ok = normalizeProjectUrl(long, MAX_DEMO_URL_LENGTH);
  expect(ok).toEqual({ ok: true, url: long });
  const tooLong = normalizeProjectUrl("https://strudel.cc/#" + "a".repeat(11000), MAX_DEMO_URL_LENGTH);
  expect(tooLong.ok).toBe(true);
  if (tooLong.ok) expect(tooLong.url.length).toBe(MAX_DEMO_URL_LENGTH);
});
