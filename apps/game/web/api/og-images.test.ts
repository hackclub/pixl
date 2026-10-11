import { afterEach, describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { Canvas, decodePNG, hex, MAX_DECODE_PIXELS } from "./_lib/png.ts";
import { assertSafeUrl, safeFetchBytes } from "./_lib/safeFetch.ts";
import { createImageBudget, fetchCardImage } from "./_lib/cardImage.ts";
import projectOg from "./project-og.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// decodePNG never checks chunk CRCs, so the test PNGs leave them zeroed.
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

function rgbaPng(width: number, height: number, idat: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

type FetchCall = { url: string; redirect?: RequestRedirect };

// Stands in for the network: each call is answered by `respond`, and every
// URL actually requested is recorded.
function mockFetch(respond: (url: string) => Response) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, redirect: init?.redirect });
    return respond(url);
  }) as typeof fetch;
  return calls;
}

describe("decodePNG limits", () => {
  test("still decodes an ordinary PNG", () => {
    const png = new Canvas(3, 2, hex("#0a141e")).encode();
    const img = decodePNG(png);
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect([...img.rgba.slice(0, 4)]).toEqual([10, 20, 30, 255]);
  });

  test("refuses a header claiming more than MAX_DECODE_PIXELS before allocating", () => {
    const png = rgbaPng(20_000, 20_000, deflateSync(new Uint8Array(16)));
    expect(20_000 * 20_000).toBeGreaterThan(MAX_DECODE_PIXELS);
    const started = performance.now();
    expect(() => decodePNG(png)).toThrow(/too large/);
    expect(performance.now() - started).toBeLessThan(50);
  });

  test("stops inflating at the size the header declares", () => {
    // 16x16 RGBA needs (16 * 4 + 1) * 16 = 1040 bytes; this inflates to 5 MB.
    const png = rgbaPng(16, 16, deflateSync(new Uint8Array(5_000_000)));
    expect(() => decodePNG(png)).toThrow();
  });

  test("rejects pixel data shorter than the header declares", () => {
    const png = rgbaPng(16, 16, deflateSync(new Uint8Array(100)));
    expect(() => decodePNG(png)).toThrow(/truncated/);
  });
});

describe("assertSafeUrl", () => {
  const blocked = [
    "http://127.0.0.1/a.png",
    "http://10.1.2.3/a.png",
    "http://100.64.0.1/a.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.1/a.png",
    "http://198.18.0.1/a.png",
    "http://224.0.0.1/a.png",
    "http://255.255.255.255/a.png",
    "http://[::1]/a.png",
    "http://[::]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://[::ffff:a9fe:a9fe]/a.png",
    "http://[64:ff9b::a9fe:a9fe]/a.png",
    "http://[fd00::1]/a.png",
    "http://[fe80::1]/a.png",
    "http://[ff02::1]/a.png",
    "http://localhost/a.png",
    "file:///etc/passwd",
    "ftp://93.184.216.34/a.png",
  ];
  for (const url of blocked) {
    test(`blocks ${url}`, async () => {
      await expect(assertSafeUrl(url)).rejects.toThrow();
    });
  }

  test("allows public addresses", async () => {
    await expect(assertSafeUrl("https://93.184.216.34/a.png")).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("https://[2606:4700::1111]/a.png")).resolves.toBeInstanceOf(URL);
  });
});

describe("safeFetchBytes", () => {
  test("re-checks a redirect and never follows one into a private address", async () => {
    const calls = mockFetch(() =>
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    );
    await expect(safeFetchBytes("https://93.184.216.34/a.png")).rejects.toThrow(/private address/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.redirect).toBe("manual");
  });

  test("follows redirects between public addresses, relative ones included", async () => {
    const calls = mockFetch((url) => {
      if (url === "https://93.184.216.34/a.png")
        return new Response(null, { status: 301, headers: { location: "https://93.184.216.35/b.png" } });
      if (url === "https://93.184.216.35/b.png")
        return new Response(null, { status: 302, headers: { location: "/c.png" } });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const bytes = await safeFetchBytes("https://93.184.216.34/a.png");
    expect([...bytes!]).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://93.184.216.34/a.png",
      "https://93.184.216.35/b.png",
      "https://93.184.216.35/c.png",
    ]);
  });

  test("gives up after too many redirects", async () => {
    const calls = mockFetch(() =>
      new Response(null, { status: 302, headers: { location: "https://93.184.216.34/again.png" } }),
    );
    await expect(safeFetchBytes("https://93.184.216.34/a.png")).rejects.toThrow(/too many redirects/);
    expect(calls).toHaveLength(4);
  });

  test("refuses a body whose Content-Length is over the cap", async () => {
    mockFetch(() => new Response(new Uint8Array(10), { headers: { "content-length": "999999" } }));
    await expect(safeFetchBytes("https://93.184.216.34/a.png", { maxBytes: 1000 })).rejects.toThrow(/too large/);
  });

  test("stops reading a streamed body once it passes the cap", async () => {
    let pulled = 0;
    mockFetch(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulled++;
              if (pulled > 1000) controller.close();
              else controller.enqueue(new Uint8Array(512));
            },
          }),
        ),
    );
    await expect(safeFetchBytes("https://93.184.216.34/a.png", { maxBytes: 4096 })).rejects.toThrow(/larger than/);
    expect(pulled).toBeLessThan(20);
  });

  test("returns null for a non-2xx response", async () => {
    mockFetch(() => new Response("nope", { status: 404 }));
    expect(await safeFetchBytes("https://93.184.216.34/a.png")).toBeNull();
  });
});

describe("image fetch budget", () => {
  test("allows `limit` fetches per window, then refills", () => {
    let now = 0;
    const take = createImageBudget(2, 1000, () => now);
    expect([take(), take(), take()]).toEqual([true, true, false]);
    now = 999;
    expect(take()).toBe(false);
    now = 1000;
    expect(take()).toBe(true);
  });

  test("skips the fetch entirely when over budget, and says so", async () => {
    const calls = mockFetch(() => new Response(new Uint8Array([1])));
    const image = await fetchCardImage("https://93.184.216.34/a.png", "test", () => false);
    expect(image).toEqual({ bytes: null, throttled: true });
    expect(calls).toHaveLength(0);
  });

  test("a missing URL doesn't spend budget", async () => {
    let spent = 0;
    const image = await fetchCardImage("", "test", () => {
      spent++;
      return true;
    });
    expect(image).toEqual({ bytes: null, throttled: false });
    expect(spent).toBe(0);
  });
});

describe("project-og", () => {
  test("still renders the card when the image redirects to an internal address, without fetching it", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/api/explore/projects/"))
        return Response.json({
          ok: true,
          project: { name: "Test", status: "approved", image_url: "https://93.184.216.34/a.png" },
          owner: { display_name: "someone" },
        });
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    });
    let status = 0;
    let body: Uint8Array | string | undefined;
    const headers: Record<string, string> = {};
    await projectOg(
      { url: "/api/project-og?id=42" },
      {
        set statusCode(s: number) {
          status = s;
        },
        get statusCode() {
          return status;
        },
        setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v),
        end: (c?: Uint8Array | string) => void (body = c),
      },
    );
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("image/png");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(calls.some((c) => c.url.includes("169.254.169.254"))).toBe(false);
  });
});
