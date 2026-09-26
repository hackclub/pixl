import { describe, expect, test } from "bun:test";
import { censorChat, containsBlocked } from "./moderation.js";

describe("containsBlocked", () => {
  test("real profanity is still caught", () => {
    expect(containsBlocked("fuck you")).toBe(true);
    expect(containsBlocked("f.u-c_k")).toBe(true);
    expect(containsBlocked("sh1t")).toBe(true);
    expect(containsBlocked("shit")).toBe(true);
    expect(containsBlocked("fuuuck")).toBe(true);
    expect(containsBlocked("shiiit")).toBe(true);
  });

  test("a blocked word set off by a real separator is still caught", () => {
    expect(containsBlocked("i.do_random.shit")).toBe(true);
  });

  // Reported false positives: real display names/words rejected only because
  // a blocked substring happened to appear inside an unrelated word.
  test("Prokshith is not a violation ('shit' embedded mid-word)", () => {
    expect(containsBlocked("Prokshith")).toBe(false);
  });

  test("NotSuspiciousProgrammer is not a violation ('spic' embedded mid-word)", () => {
    expect(containsBlocked("NotSuspiciousProgrammer")).toBe(false);
  });

  test("frappecchino is not a violation (doubled letters used to collapse into 'rape')", () => {
    expect(containsBlocked("frappecchino")).toBe(false);
  });

  test("grape/grapes are not violations ('rape' embedded mid-word)", () => {
    expect(containsBlocked("grape")).toBe(false);
    expect(containsBlocked("grapes")).toBe(false);
  });

  test("Scunthorpe is not a violation ('cunt' embedded mid-word)", () => {
    expect(containsBlocked("Scunthorpe")).toBe(false);
  });

  test("cockpit/peacock are not violations ('cock' embedded mid-word)", () => {
    expect(containsBlocked("cockpit")).toBe(false);
    expect(containsBlocked("peacock")).toBe(false);
  });

  test("standalone use of a word-boundary word is still caught", () => {
    expect(containsBlocked("shit")).toBe(true);
    expect(containsBlocked("rape")).toBe(true);
    expect(containsBlocked("that's a cunt move")).toBe(true);
  });
});

describe("censorChat", () => {
  test("censors real profanity", () => {
    expect(censorChat("that is fuck ing bad")).not.toBe("that is fuck ing bad");
    expect(censorChat("holy shit")).toContain("****");
  });

  test("does not censor innocent words that embed a blocked word", () => {
    expect(censorChat("I love grapes and cockpit views")).toBe("I love grapes and cockpit views");
    expect(censorChat("Prokshith said hi")).toBe("Prokshith said hi");
  });
});
