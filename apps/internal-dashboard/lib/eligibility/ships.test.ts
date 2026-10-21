import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSnapshot,
  createShipsProvider,
  manualShipsRefresh,
  repoKeyOf,
  resetManualRefreshLimits,
  shipsUrlFromEnv,
  ttlFromEnv,
} from "./ships";

const rec = (n: number) => `rec${String(n).padStart(14, "0")}`;
const entry = (over: Record<string, unknown> = {}) => ({
  id: rec(1),
  ysws: "Pixl",
  approved_at: 1_792_000_000,
  code_url: "https://github.com/a/b",
  country: "NL",
  demo_url: "https://x.example",
  description: "private text",
  github_username: "Someone",
  hours: 5,
  screenshot_url: "https://img.example/x.png",
  github_stars: 0,
  display_name: "Real Name",
  slack_id: "null",
  archived_demo: "x",
  archived_repo: "y",
  ...over,
});

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" }, ...init });

function clock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("snapshot building", () => {
  test("keeps only PIXL entries, case-insensitively, and ignores other programs", () => {
    const s = buildSnapshot(
      [
        entry({ id: rec(1), ysws: "Pixl" }),
        entry({ id: rec(2), ysws: "PIXL" }),
        entry({ id: rec(3), ysws: " pixl " }),
        entry({ id: rec(4), ysws: "Macondo" }),
        entry({ id: rec(5), ysws: "Pixl Cafe" }),
        entry({ id: rec(6), ysws: null }),
        null,
        "junk",
      ],
      1,
    );
    expect([...s.byId.keys()].sort()).toEqual([rec(1), rec(2), rec(3)]);
    expect(s.pixlCount).toBe(3);
    expect(s.totalReturned).toBe(8);
  });

  test("validates records one by one and remembers malformed ids", () => {
    const s = buildSnapshot(
      [
        entry({ id: rec(1) }),
        entry({ id: rec(2), hours: -1 }),
        entry({ id: rec(3), hours: "5" }),
        entry({ id: rec(4), hours: null }),
        entry({ id: "not-a-record", hours: 1 }),
        entry({ id: rec(6), approved_at: "yesterday" }),
        entry({ id: rec(7), code_url: 5 }),
        entry({ id: rec(8), approved_at: null }),
      ],
      1,
    );
    expect([...s.byId.keys()].sort()).toEqual([rec(1), rec(8)]);
    expect(s.invalidCount).toBe(6);
    expect(s.invalidIds.has(rec(2))).toBe(true);
    expect(s.byId.get(rec(8))!.approvedAt).toBeNull();
  });

  test("duplicate record ids are removed from the index and flagged ambiguous", () => {
    const s = buildSnapshot([entry({ id: rec(1), hours: 3 }), entry({ id: rec(1), hours: 9 }), entry({ id: rec(2) })], 1);
    expect(s.byId.has(rec(1))).toBe(false);
    expect(s.ambiguousIds.has(rec(1))).toBe(true);
    expect(s.duplicateCount).toBe(1);
    expect(s.byId.has(rec(2))).toBe(true);
  });

  test("indexes by repository and GitHub username, and drops personal fields", () => {
    const s = buildSnapshot(
      [entry({ id: rec(1), code_url: "https://github.com/Foo/Bar.git", github_username: "FooUser", slack_id: "U123" })],
      1,
    );
    expect(s.byRepo.get("github.com/foo/bar")!.length).toBe(1);
    expect(s.byGithub.get("foouser")!.length).toBe(1);
    const kept = s.byId.get(rec(1))!;
    expect(Object.keys(kept).sort()).toEqual(["approvedAt", "codeUrl", "githubUsername", "hours", "id", "repoKey", "slackId"]);
    expect(kept.slackId).toBe("U123");
  });

  test("a non-array payload is rejected", () => {
    expect(() => buildSnapshot({ entries: [] }, 1)).toThrow();
  });

  test("repo keys ignore scheme noise, trailing paths and .git", () => {
    expect(repoKeyOf("https://GitHub.com/A/B/tree/main")).toBe("github.com/a/b");
    expect(repoKeyOf("not a url")).toBeNull();
    expect(repoKeyOf(null)).toBeNull();
  });
});

describe("provider fetch", () => {
  test("issues one GET with no credentials and no body", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const p = createShipsProvider({
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), init: init ?? {} });
        return json([entry()]);
      }) as typeof fetch,
    });
    const v = await p.get();
    expect(v.snapshot!.pixlCount).toBe(1);
    expect(seen.length).toBe(1);
    expect(seen[0]!.url).toBe("https://ships.hackclub.com/api/v1/ysws_entries");
    expect(seen[0]!.init.method).toBe("GET");
    expect(seen[0]!.init.body).toBeUndefined();
    const h = seen[0]!.init.headers as Record<string, string>;
    expect(Object.keys(h).map((k) => k.toLowerCase()).sort()).toEqual(["accept"]);
  });

  test("invalid JSON is an error and leaves no snapshot", async () => {
    const p = createShipsProvider({ fetchImpl: (async () => new Response("{not json")) as typeof fetch });
    const v = await p.get();
    expect(v.snapshot).toBeNull();
    expect(v.error).toContain("not valid JSON");
    expect(v.fresh).toBe(false);
  });

  test("HTTP errors are reported", async () => {
    const p = createShipsProvider({ fetchImpl: (async () => new Response("no", { status: 503 })) as typeof fetch });
    expect((await p.get()).error).toContain("HTTP 503");
  });

  test("a hung request is aborted by the timeout", async () => {
    const p = createShipsProvider({
      timeoutMs: 20,
      fetchImpl: ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        })) as typeof fetch,
    });
    const v = await p.get();
    expect(v.snapshot).toBeNull();
    expect(v.error).toContain("timed out");
  });

  test("a body shorter than content-length is treated as truncated, not authoritative", async () => {
    const body = JSON.stringify([entry()]);
    const p = createShipsProvider({
      fetchImpl: (async () =>
        new Response(body.slice(0, 20), { headers: { "content-length": String(body.length) } })) as typeof fetch,
    });
    const v = await p.get();
    expect(v.snapshot).toBeNull();
    expect(v.error).toBeTruthy();
  });

  test("an oversized response is refused", async () => {
    const p = createShipsProvider({
      maxBytes: 10,
      fetchImpl: (async () => json([entry()], { headers: { "content-length": "999999" } })) as typeof fetch,
    });
    expect((await p.get()).error).toContain("too large");
  });

  test("a non-array body is refused", async () => {
    const p = createShipsProvider({ fetchImpl: (async () => json({ ok: true })) as typeof fetch });
    expect((await p.get()).error).toContain("not a JSON array");
  });

  test("redirects are not followed", async () => {
    let redirect: RequestRedirect | undefined;
    const p = createShipsProvider({
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        redirect = init?.redirect;
        return json([]);
      }) as typeof fetch,
    });
    await p.get();
    expect(redirect).toBe("error");
  });
});

describe("provider cache", () => {
  test("simultaneous callers share one in-flight request", async () => {
    let calls = 0;
    const p = createShipsProvider({
      fetchImpl: (async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 15));
        return json([entry()]);
      }) as typeof fetch,
    });
    const views = await Promise.all(Array.from({ length: 12 }, () => p.get()));
    expect(calls).toBe(1);
    expect(new Set(views.map((v) => v.snapshot)).size).toBe(1);
  });

  test("serves the cache inside the ttl and refetches after it", async () => {
    const c = clock();
    let calls = 0;
    const p = createShipsProvider({
      ttlMs: 5 * 60_000,
      now: c.now,
      fetchImpl: (async () => {
        calls++;
        return json([entry()]);
      }) as typeof fetch,
    });
    await p.get();
    c.advance(4 * 60_000);
    const mid = await p.get();
    expect(calls).toBe(1);
    expect(mid.fresh).toBe(true);
    c.advance(2 * 60_000);
    await p.get();
    expect(calls).toBe(2);
  });

  test("a failed refresh keeps the old snapshot but marks it stale with its true age", async () => {
    const c = clock();
    let fail = false;
    const p = createShipsProvider({
      ttlMs: 60_000,
      now: c.now,
      fetchImpl: (async () => (fail ? new Response("x", { status: 500 }) : json([entry()]))) as typeof fetch,
    });
    const first = await p.get();
    const fetchedAt = first.fetchedAt;
    fail = true;
    c.advance(10 * 60_000);
    const v = await p.get();
    expect(v.snapshot).not.toBeNull();
    expect(v.fresh).toBe(false);
    expect(v.fetchedAt).toBe(fetchedAt);
    expect(v.ageMs).toBe(10 * 60_000);
    expect(v.error).toContain("500");
  });

  test("failures back off exponentially instead of hammering the API", async () => {
    const c = clock();
    let calls = 0;
    const p = createShipsProvider({
      ttlMs: 60_000,
      now: c.now,
      fetchImpl: (async () => {
        calls++;
        return new Response("x", { status: 500 });
      }) as typeof fetch,
    });
    await p.get();
    await p.get();
    await p.get();
    expect(calls).toBe(1);
    c.advance(31_000);
    await p.get();
    expect(calls).toBe(2);
    c.advance(31_000);
    await p.get();
    expect(calls).toBe(2);
    c.advance(31_000);
    await p.get();
    expect(calls).toBe(3);
  });

  test("a successful refresh clears the error and the backoff", async () => {
    const c = clock();
    let fail = true;
    const p = createShipsProvider({
      ttlMs: 60_000,
      now: c.now,
      fetchImpl: (async () => (fail ? new Response("x", { status: 500 }) : json([entry()]))) as typeof fetch,
    });
    await p.get();
    fail = false;
    c.advance(31_000);
    const v = await p.get();
    expect(v.error).toBeNull();
    expect(v.fresh).toBe(true);
    expect(v.nextRetryAt).toBeNull();
  });

  test("revalidates with the etag and a 304 only renews the timestamp", async () => {
    const c = clock();
    const seen: (string | null)[] = [];
    const p = createShipsProvider({
      ttlMs: 60_000,
      now: c.now,
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        const h = init?.headers as Record<string, string>;
        seen.push(h["If-None-Match"] ?? null);
        return seen.length === 1
          ? json([entry()], { headers: { etag: 'W/"abc"' } })
          : new Response(null, { status: 304 });
      }) as typeof fetch,
    });
    const first = await p.get();
    c.advance(61_000);
    const second = await p.get();
    expect(seen).toEqual([null, 'W/"abc"']);
    expect(second.snapshot!.byId).toBe(first.snapshot!.byId);
    expect(second.fetchedAt).toBe(c.now());
  });

  test("a dataset that suddenly shrinks is not accepted as authoritative", async () => {
    const c = clock();
    let big = true;
    const p = createShipsProvider({
      ttlMs: 60_000,
      now: c.now,
      fetchImpl: (async () =>
        json(big ? Array.from({ length: 40 }, (_, i) => entry({ id: rec(i + 1) })) : [entry({ id: rec(1) })])) as typeof fetch,
    });
    await p.get();
    big = false;
    c.advance(61_000);
    const v = await p.get();
    expect(v.snapshot!.pixlCount).toBe(40);
    expect(v.error).toContain("shrank");
  });

  test("the API url can only be overridden with https or localhost", () => {
    expect(shipsUrlFromEnv(undefined)).toBe("https://ships.hackclub.com/api/v1/ysws_entries");
    expect(shipsUrlFromEnv("http://127.0.0.1:4920/x")).toBe("http://127.0.0.1:4920/x");
    expect(shipsUrlFromEnv("https://ships.example.test/x")).toBe("https://ships.example.test/x");
    expect(shipsUrlFromEnv("http://evil.example/x")).toBe("https://ships.hackclub.com/api/v1/ysws_entries");
    expect(shipsUrlFromEnv("file:///etc/passwd")).toBe("https://ships.hackclub.com/api/v1/ysws_entries");
  });

  test("env ttl is clamped to a sane range", () => {
    expect(ttlFromEnv(undefined)).toBe(300_000);
    expect(ttlFromEnv("10")).toBe(60_000);
    expect(ttlFromEnv("99999999999")).toBe(3_600_000);
    expect(ttlFromEnv("abc")).toBe(300_000);
  });
});

describe("manual refresh", () => {
  test("is rate limited per actor and across staff", async () => {
    resetManualRefreshLimits();
    let calls = 0;
    const p = createShipsProvider({
      fetchImpl: (async () => {
        calls++;
        return json([entry()]);
      }) as typeof fetch,
    });
    const t0 = 1_800_000_000_000;
    const a = await manualShipsRefresh("UA", p, t0);
    expect(a.ok).toBe(true);
    const again = await manualShipsRefresh("UA", p, t0 + 5_000);
    const other = await manualShipsRefresh("UB", p, t0 + 5_000);
    expect(again.ok).toBe(false);
    expect(other.ok).toBe(false);
    if (!again.ok && again.reason === "rate_limited") expect(again.retryInMs).toBeGreaterThan(0);
    const later = await manualShipsRefresh("UB", p, t0 + 61_000);
    expect(later.ok).toBe(true);
    expect(calls).toBe(2);
    resetManualRefreshLimits();
  });

  test("reports a failed refresh without inventing fresh data", async () => {
    resetManualRefreshLimits();
    const p = createShipsProvider({ fetchImpl: (async () => new Response("x", { status: 502 })) as typeof fetch });
    const r = await manualShipsRefresh("UA", p, 1_800_000_000_000);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "failed") expect(r.error).toContain("502");
    resetManualRefreshLimits();
  });
});

describe("wiring", () => {
  const root = join(import.meta.dir, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  test("the refresh action is a fulfiller-gated server action", () => {
    expect(read("app/actions.ts")).toMatch(/export const refreshShipsSnapshot = guardedAction\("refreshShipsSnapshot", "fulfiller"/);
  });

  test("the provider never writes and no client component imports it", () => {
    expect(read("lib/eligibility/ships.ts")).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [join(dir, d.name)] : [],
      );
    const offenders = walk("app").filter((f) => {
      const src = read(f);
      return /^["']use client["']/m.test(src) && /eligibility\/ships/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
