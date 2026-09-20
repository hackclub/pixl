import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "pixl.js"), "utf8");
const start = source.indexOf("// <login-intake>");
const end = source.indexOf("// </login-intake>");
if (start === -1 || end === -1) throw new Error("login-intake markers missing from pixl.js");
const block = source.slice(start, end);

function makePage(origin = "https://pixl.hackclub.com", pathname = "/shop/") {
  const store = new Map<string, string>();
  const clock = { now: 1_000_000 };
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const fakeDate = { now: () => clock.now };
  const api = new Function(
    "localStorage",
    "crypto",
    "Date",
    "API",
    "location",
    `${block}\nreturn { loginUrl, loginNonce, readLoginNonce, takeReturnedToken };`,
  )(localStorage, globalThis.crypto, fakeDate, "https://server.pixl.hackclub.com", { origin, pathname }) as {
    loginUrl: () => string;
    loginNonce: () => string;
    readLoginNonce: () => string;
    takeReturnedToken: (p: URLSearchParams) => string;
  };
  return { ...api, store, clock };
}

const ATTACKER_JWT = "attacker.jwt.value";

describe("static shell token intake", () => {
  test("a bare ?token= does not establish a session", () => {
    const page = makePage();
    expect(page.takeReturnedToken(new URLSearchParams("token=" + ATTACKER_JWT))).toBe("");
  });

  test("a ?token= with a guessed ln does not establish a session", () => {
    const page = makePage();
    page.loginNonce();
    expect(page.takeReturnedToken(new URLSearchParams(`token=${ATTACKER_JWT}&ln=deadbeef`))).toBe("");
    expect(page.takeReturnedToken(new URLSearchParams(`token=${ATTACKER_JWT}&ln=`))).toBe("");
  });

  test("an attacker's own completed login link fails in a browser that never started that login", () => {
    const attackerBrowser = makePage();
    const attackerNonce = attackerBrowser.loginNonce();
    const victimBrowser = makePage();
    expect(victimBrowser.takeReturnedToken(new URLSearchParams(`token=${ATTACKER_JWT}&ln=${attackerNonce}`))).toBe("");
  });

  test("a login this browser started completes", () => {
    const page = makePage();
    const nonce = page.loginNonce();
    expect(page.takeReturnedToken(new URLSearchParams(`token=real.jwt&name=x&ln=${nonce}`))).toBe("real.jwt");
  });

  test("the login nonce is single use, so replaying the same return fails", () => {
    const page = makePage();
    const nonce = page.loginNonce();
    const returned = new URLSearchParams(`token=real.jwt&ln=${nonce}`);
    expect(page.takeReturnedToken(returned)).toBe("real.jwt");
    expect(page.takeReturnedToken(returned)).toBe("");
    expect(page.readLoginNonce()).toBe("");
  });

  test("an expired login attempt is rejected", () => {
    const page = makePage();
    const nonce = page.loginNonce();
    page.clock.now += 10 * 60 * 1000 + 1;
    expect(page.takeReturnedToken(new URLSearchParams(`token=real.jwt&ln=${nonce}`))).toBe("");
  });

  test("a rejected attempt does not burn the visitor's own pending login", () => {
    const page = makePage();
    const nonce = page.loginNonce();
    expect(page.takeReturnedToken(new URLSearchParams("token=" + ATTACKER_JWT))).toBe("");
    expect(page.takeReturnedToken(new URLSearchParams(`token=real.jwt&ln=${nonce}`))).toBe("real.jwt");
  });

  test("every login link on a page shares one nonce, and it is random", () => {
    const page = makePage();
    expect(page.loginNonce()).toBe(page.loginNonce());
    expect(page.loginNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(makePage().loginNonce()).not.toBe(page.loginNonce());
  });

  test("loginUrl carries the nonce and the origin plus path to return to", () => {
    const page = makePage("https://pixl.hackclub.com", "/shop/");
    const url = new URL(page.loginUrl());
    expect(url.origin + url.pathname).toBe("https://server.pixl.hackclub.com/auth/hackclub");
    expect(url.searchParams.get("web_redirect")).toBe("https://pixl.hackclub.com/shop/");
    expect(url.searchParams.get("nonce")).toBe(page.readLoginNonce());
  });

  test("intake in pixl.js is only reachable through the nonce check", () => {
    expect(source.match(/localStorage\.setItem\("pixl_token"/g)).toHaveLength(1);
    expect(source).toContain("let token = takeReturnedToken(params);");
  });
});
