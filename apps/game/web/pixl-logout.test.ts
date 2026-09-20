import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "pixl.js"), "utf8");
const start = source.indexOf("// <logout-sync>");
const end = source.indexOf("// </logout-sync>");
if (start === -1 || end === -1) throw new Error("logout-sync markers missing from pixl.js");
const block = source.slice(start, end);

function makeHarness(selfOrigin = "https://pixl.rsvp", play = "https://play.pixl.hackclub.com") {
  const listeners: Record<string, (e: unknown) => void> = {};
  const opener = {};
  const win = {
    opener,
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      listeners[t] = fn;
    },
  };
  let signouts = 0;
  const api = new Function(
    "window",
    "location",
    "config",
    "signedOut",
    `${block}\nreturn { logoutSenderAllowed };`,
  )(win, { origin: selfOrigin }, { urls: { play } }, () => {
    signouts++;
  }) as { logoutSenderAllowed: (o: unknown) => boolean };
  const post = (origin: unknown, src: unknown = opener, data: unknown = { pixl: "logout" }) =>
    listeners["message"]({ source: src, origin, data });
  return { ...api, post, opener, signoutCount: () => signouts };
}

describe("game logout sync origin check", () => {
  test("a malicious opener cannot force sign-out (logout CSRF)", () => {
    const page = makeHarness();
    page.post("https://evil.com");
    page.post("https://pixl.rsvp.evil.com");
    page.post("https://evil.com", page.opener);
    expect(page.signoutCount()).toBe(0);
  });

  test("a non-opener cannot trigger it even from a legit origin", () => {
    const page = makeHarness();
    page.post("https://play.pixl.rsvp", {});
    expect(page.signoutCount()).toBe(0);
  });

  test("non-logout messages are ignored", () => {
    const page = makeHarness();
    page.post("https://play.pixl.rsvp", page.opener, { pixl: "hello" });
    page.post("https://play.pixl.rsvp", page.opener, null);
    expect(page.signoutCount()).toBe(0);
  });

  test("the game on the play host signs the shell out", () => {
    const page = makeHarness("https://pixl.rsvp", "https://play.pixl.hackclub.com");
    page.post("https://play.pixl.rsvp");
    expect(page.signoutCount()).toBe(1);
  });

  test("the configured play origin signs the shell out", () => {
    const page = makeHarness("https://pixl.hackclub.com", "https://play.pixl.hackclub.com");
    page.post("https://play.pixl.hackclub.com");
    expect(page.signoutCount()).toBe(1);
  });

  test("same-origin opener still works (apex-hosted game, localhost dev)", () => {
    const page = makeHarness("https://pixl.rsvp");
    page.post("https://pixl.rsvp");
    expect(page.signoutCount()).toBe(1);
    const local = makeHarness("http://localhost:8000");
    local.post("http://localhost:8000");
    expect(local.signoutCount()).toBe(1);
  });

  test("plaintext http origins are rejected cross-origin", () => {
    const page = makeHarness();
    expect(page.logoutSenderAllowed("http://play.pixl.rsvp")).toBe(false);
    expect(page.logoutSenderAllowed("")).toBe(false);
    expect(page.logoutSenderAllowed(null)).toBe(false);
    expect(page.logoutSenderAllowed("javascript:alert(1)")).toBe(false);
  });
});
