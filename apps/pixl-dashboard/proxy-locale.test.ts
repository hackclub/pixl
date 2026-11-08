import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { config, createFixedWindowLimiter, detectLocale, proxy } from "./proxy.ts";

describe("detectLocale", () => {
  test("country wins", () => expect(detectLocale("BR", "en-US")).toBe("pt"));
  test("accept-language by q", () => expect(detectLocale(null, "de;q=0.9,fr;q=0.8,en;q=0.1")).toBe("fr"));
  test("falls back to en", () => expect(detectLocale("DE", "de-DE")).toBe("en"));
});

describe("landing locale redirect", () => {
  test("first visit to / from a French browser goes to /fr", () => {
    const res = proxy(new NextRequest("https://pixl.hackclub.com/", { headers: { "accept-language": "fr-FR" } }));
    expect(res.headers.get("location")).toBe("https://pixl.hackclub.com/fr");
  });
  test("an existing locale cookie is respected", () => {
    const res = proxy(
      new NextRequest("https://pixl.hackclub.com/", { headers: { "accept-language": "fr-FR", cookie: "pixl_locale=en" } }),
    );
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  test("never redirects non-root paths", () => {
    const res = proxy(new NextRequest("https://pixl.hackclub.com/dashboard", { headers: { "accept-language": "fr-FR" } }));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("OAuth callback flood guard", () => {
  test("permits regular traffic, rejects excess, and resets every second", () => {
    const allowed = createFixedWindowLimiter(3, 1000);
    expect(allowed(1200)).toBe(true);
    expect(allowed(1200)).toBe(true);
    expect(allowed(1500)).toBe(true);
    expect(allowed(1501)).toBe(false);
    expect(allowed(2000)).toBe(true);
    expect(allowed(2000)).toBe(true);
  });

  test("does not throttle ordinary page requests", () => {
    const res = proxy(new NextRequest("https://pixl.hackclub.com/projects"));
    expect(res.status).toBe(200);
  });
});


describe("expired-session flood guard", () => {
  test("explicitly matches the expiry endpoint before the app route", () => {
    expect(config.matcher.some((entry) => "source" in entry && entry.source === "/api/auth/expired")).toBe(true);
    expect(proxy(new NextRequest("https://pixl.hackclub.com/api/auth/expired")).status).toBe(200);
  });
});
