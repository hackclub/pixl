import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { config } from "@/app/_generated/config";
import { GET } from "./route.ts";

// F-8: this route is the only place a login starts - it must drop a fresh,
// unguessable nonce as an httpOnly cookie before ever sending the browser
// to apps/server, and pass the same value along as ?nonce= so it can be
// threaded through the OAuth round trip and checked again by proxy.ts.
describe("GET /api/login", () => {
  test("redirects to apps/server's /auth/hackclub with web_redirect and a nonce", async () => {
    const req = new NextRequest("http://localhost/api/login?back=https%3A%2F%2Fpixl.hackclub.com%2Fdashboard");
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${new URL(config.urls.server).origin}/auth/hackclub`);
    expect(location.searchParams.get("web_redirect")).toBe("https://pixl.hackclub.com/dashboard");
    expect(location.searchParams.get("nonce")).toBeTruthy();
    expect(location.searchParams.get("nonce")!.length).toBeGreaterThanOrEqual(16);
  });

  test("sets the login-nonce cookie to the exact same value passed as ?nonce=", async () => {
    const req = new NextRequest("http://localhost/api/login?back=https%3A%2F%2Fpixl.hackclub.com%2F");
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    const nonce = location.searchParams.get("nonce") ?? undefined;
    const cookie = res.cookies.get("pixl_login_nonce");
    expect(cookie?.value).toBe(nonce);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  test("two requests get two different, unguessable nonces", async () => {
    const req1 = new NextRequest("http://localhost/api/login?back=https%3A%2F%2Fpixl.hackclub.com%2F");
    const req2 = new NextRequest("http://localhost/api/login?back=https%3A%2F%2Fpixl.hackclub.com%2F");
    const res1 = await GET(req1);
    const res2 = await GET(req2);
    const nonce1 = new URL(res1.headers.get("location")!).searchParams.get("nonce") ?? undefined;
    const nonce2 = new URL(res2.headers.get("location")!).searchParams.get("nonce") ?? undefined;
    expect(nonce1).not.toBe(nonce2);
  });

  test("a missing back= still redirects with an empty web_redirect rather than throwing", async () => {
    const req = new NextRequest("http://localhost/api/login");
    const res = await GET(req);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("web_redirect")).toBe("");
  });
});
