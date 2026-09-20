import { afterEach, describe, expect, mock, test } from "bun:test";
import { POST } from "./route";

const CF_PEER = "162.158.10.20";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function rsvp(headers: Record<string, string>, email = "not-an-email") {
  return POST(
    new Request("http://landing.test/api/rsvp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email }),
    }),
  );
}

async function statuses(count: number, headersFor: (i: number) => Record<string, string>) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push((await rsvp(headersFor(i))).status);
  return out;
}

describe("rsvp rate limit", () => {
  test("blocks after the configured threshold", async () => {
    const out = await statuses(7, () => ({ "x-forwarded-for": "198.51.100.10" }));
    expect(out).toEqual([400, 400, 400, 400, 400, 429, 429]);
  });

  test("rotating a forged CF-Connecting-IP from a direct peer does not bypass the limit", async () => {
    const out = await statuses(7, (i) => ({
      "x-forwarded-for": "198.51.100.11",
      "cf-connecting-ip": `203.0.113.${i + 1}`,
    }));
    expect(out.slice(5)).toEqual([429, 429]);
  });

  test("rotating a spoofed X-Forwarded-For prefix does not bypass the limit", async () => {
    const out = await statuses(7, (i) => ({ "x-forwarded-for": `10.9.8.${i + 1}, 198.51.100.12` }));
    expect(out.slice(5)).toEqual([429, 429]);
  });

  test("a spoofed Cloudflare peer on the left of X-Forwarded-For does not unlock CF-Connecting-IP", async () => {
    const out = await statuses(7, (i) => ({
      "x-forwarded-for": `${CF_PEER}, 198.51.100.13`,
      "cf-connecting-ip": `203.0.113.${100 + i}`,
    }));
    expect(out.slice(5)).toEqual([429, 429]);
  });

  test("behind Cloudflare each real client gets its own bucket", async () => {
    const a = await statuses(6, () => ({ "x-forwarded-for": CF_PEER, "cf-connecting-ip": "203.0.113.50" }));
    expect(a.slice(5)).toEqual([429]);
    const b = await statuses(1, () => ({ "x-forwarded-for": CF_PEER, "cf-connecting-ip": "203.0.113.51" }));
    expect(b).toEqual([400]);
  });

  test("different IPv4-mapped IPv6 peers do not share a bucket", async () => {
    const a = await statuses(6, () => ({ "x-forwarded-for": "::ffff:1.2.3.4" }));
    expect(a.slice(5)).toEqual([429]);
    const b = await statuses(1, () => ({ "x-forwarded-for": "::ffff:9.9.9.9" }));
    expect(b).toEqual([400]);
  });
});

describe("rsvp signup", () => {
  test("a normal signup succeeds once", async () => {
    const calls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
      if (init?.method === "POST") return Response.json({ id: "rec1" });
      return Response.json({ records: [] });
    }) as unknown as typeof fetch;
    const res = await rsvp({ "x-forwarded-for": "198.51.100.20" }, "player@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  test("an Airtable failure is reported as a failure, not success", async () => {
    globalThis.fetch = mock(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const res = await rsvp({ "x-forwarded-for": "198.51.100.21" }, "player@example.com");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "signup_failed" });
  });
});
