import { afterEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy.ts";

// Next's own global.d.ts types NODE_ENV as readonly, so a plain assignment
// doesn't typecheck - defineProperty is the standard escape hatch for
// flipping it within a test.
function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, writable: true });
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
});

function reqWithNonceCookie(url: string, nonce: string): NextRequest {
  return new NextRequest(url, { headers: { cookie: `pixl_login_nonce=${nonce}` } });
}

describe("proxy", () => {
  test("passes through untouched when there's no token in the URL", () => {
    const req = new NextRequest("http://localhost/docs/welcome/");
    const res = proxy(req);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("forwards the request path so the signed-out gate can build a return url", () => {
    const req = new NextRequest("http://localhost/dashboard?embed=1");
    const res = proxy(req);
    // NextResponse.next({request:{headers}}) encodes overridden request
    // headers onto the response for the next hop to pick up.
    expect(res.headers.get("x-middleware-request-x-pixl-path")).toBe("/dashboard?embed=1");
  });

  // F-8: a ?token= with no matching login-nonce cookie is not proof this
  // browser just finished a real login - it's exactly the shape a mailed
  // link (using the attacker's own valid token) would take. It must be
  // silently ignored rather than establishing a session as whoever the
  // token belongs to.
  describe("F-8: a ?token= without a matching login-nonce cookie is ignored", () => {
    test("no ln= at all, no login-nonce cookie: token is dropped, no session cookie set", () => {
      const req = new NextRequest("http://localhost/dashboard?embed=1&token=fake123&name=Ridit");
      const res = proxy(req);
      expect(res.headers.get("location")).toBe("http://localhost/dashboard?embed=1");
      expect(res.cookies.get("pixl_session")).toBeUndefined();
    });

    test("ln= present but no login-nonce cookie was ever set on this browser: ignored", () => {
      const req = new NextRequest("http://localhost/docs/welcome/?token=fake123&ln=someNonce");
      const res = proxy(req);
      expect(res.cookies.get("pixl_session")).toBeUndefined();
    });

    test("ln= present but doesn't match the login-nonce cookie: ignored", () => {
      const req = reqWithNonceCookie(
        "http://localhost/docs/welcome/?token=fake123&ln=wrong-value",
        "the-real-nonce",
      );
      const res = proxy(req);
      expect(res.cookies.get("pixl_session")).toBeUndefined();
    });

    test("a login-nonce cookie exists but the request supplies no ln= at all: ignored", () => {
      const req = reqWithNonceCookie("http://localhost/docs/welcome/?token=fake123", "the-real-nonce");
      const res = proxy(req);
      expect(res.cookies.get("pixl_session")).toBeUndefined();
    });

    test("the url is still cleaned up (token/name/ln stripped) even when the session isn't established", () => {
      const req = new NextRequest("http://localhost/dashboard?token=fake123&name=Ridit&ln=bogus");
      const res = proxy(req);
      expect(res.headers.get("location")).toBe("http://localhost/dashboard");
    });
  });

  describe("a matching ln= completes the real login flow", () => {
    test("redirects and sets the session cookie when ln= matches the login-nonce cookie", () => {
      const req = reqWithNonceCookie(
        "http://localhost/docs/welcome/?token=fake123&ln=the-real-nonce",
        "the-real-nonce",
      );
      const res = proxy(req);

      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost/docs/welcome/");

      const cookie = res.cookies.get("pixl_session");
      expect(cookie?.value).toBe("fake123");
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe("lax");
      expect(cookie?.secure).toBeFalsy();
    });

    test("marks the session cookie Secure in production", () => {
      setNodeEnv("production");
      const req = reqWithNonceCookie(
        "http://localhost/docs/welcome/?token=fake123&ln=the-real-nonce",
        "the-real-nonce",
      );
      const res = proxy(req);

      const cookie = res.cookies.get("pixl_session");
      expect(cookie?.secure).toBe(true);
    });

    test("the login-nonce cookie is cleared either way, so a captured URL can't be replayed", () => {
      const req = reqWithNonceCookie(
        "http://localhost/docs/welcome/?token=fake123&ln=the-real-nonce",
        "the-real-nonce",
      );
      const res = proxy(req);
      const nonceCookie = res.cookies.get("pixl_login_nonce");
      expect(nonceCookie?.value).toBe("");
    });
  });
});
