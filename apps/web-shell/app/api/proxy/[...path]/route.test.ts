import { afterEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxyRequest } from "./route.ts";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe("proxyRequest", () => {
  test("returns 401 with no token, never calling upstream", async () => {
    const fetchSpy = mock(() => {
      throw new Error("should not be called");
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/profile/wallet");
    const res = await proxyRequest(req, ["profile", "wallet"], null);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("forwards a GET with the token and query string appended", async () => {
    let capturedUrl = "";
    global.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ ok: true, pixels: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/profile/wallet?foo=bar");
    const res = await proxyRequest(req, ["profile", "wallet"], "tok123");
    expect(capturedUrl).toContain("/api/profile/wallet?foo=bar&token=tok123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pixels: 42 });
  });

  test("forwards a POST body and content-type", async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/shop/save/5", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option: "red" }),
    });
    await proxyRequest(req, ["shop", "save", "5"], "tok123");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)?.["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode(capturedInit?.body as ArrayBuffer)).toBe(JSON.stringify({ option: "red" }));
  });

  test("returns 502 when the upstream fetch fails", async () => {
    global.fetch = mock(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    const req = new NextRequest("http://localhost/api/proxy/profile/wallet");
    const res = await proxyRequest(req, ["profile", "wallet"], "tok123");
    expect(res.status).toBe(502);
  });
});
