import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { createFixedWindowLimiter, proxy } from "./proxy.ts";

describe("internal dashboard OAuth flood guard", () => {
  const state = "0123456789abcdef0123456789abcdef";

  test("rejects unauthenticated callbacks before audit work", () => {
    expect(proxy(new NextRequest("https://dash.pixl.hackclub.com/api/auth/callback")).status).toBe(400);
    expect(proxy(new NextRequest(`https://dash.pixl.hackclub.com/api/auth/callback?code=anything&state=${state}`)).status).toBe(400);
  });

  test("rejects mismatched states and malformed states", () => {
    const url = `https://dash.pixl.hackclub.com/api/auth/callback?code=valid-looking-code&state=${state}`;
    expect(proxy(new NextRequest(url, { headers: { cookie: "pixl_oauth_state=wrong" } })).status).toBe(400);
    expect(proxy(new NextRequest("https://dash.pixl.hackclub.com/api/auth/callback?code=abc&state=wrong", {
      headers: { cookie: "pixl_oauth_state=wrong" },
    })).status).toBe(400);
  });

  test("allows state-consistent callbacks and normal reviewer pages", () => {
    const res = proxy(new NextRequest(`https://dash.pixl.hackclub.com/api/auth/callback?code=valid-looking-code&state=${state}`, {
      headers: { cookie: `pixl_oauth_state=${state}` },
    }));
    expect(res.status).toBe(200);
    expect(proxy(new NextRequest("https://dash.pixl.hackclub.com/review")).status).toBe(200);
  });

  test("caps requests in a fixed window and resets on the next window", () => {
    const allow = createFixedWindowLimiter(2, 1000);
    expect(allow(1000)).toBe(true);
    expect(allow(1500)).toBe(true);
    expect(allow(1600)).toBe(false);
    expect(allow(2000)).toBe(true);
  });
});
