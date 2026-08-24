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

describe("proxy", () => {
  test("passes through untouched when there's no token in the URL", () => {
    const req = new NextRequest("http://localhost/docs/welcome/");
    const res = proxy(req);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("redirects and sets the session cookie when a token is present", () => {
    const req = new NextRequest("http://localhost/docs/welcome/?token=fake123");
    const res = proxy(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBe("http://localhost/docs/welcome/");

    const cookie = res.cookies.get("pixl_session");
    expect(cookie?.value).toBe("fake123");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.secure).toBeFalsy();
  });

  test("marks the cookie Secure in production", () => {
    setNodeEnv("production");
    const req = new NextRequest("http://localhost/docs/welcome/?token=fake123");
    const res = proxy(req);

    const cookie = res.cookies.get("pixl_session");
    expect(cookie?.secure).toBe(true);
  });
});
