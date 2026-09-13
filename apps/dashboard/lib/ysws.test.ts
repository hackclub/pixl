import { afterEach, describe, expect, test } from "bun:test";
import { __resetArchiveForTests, yswsShipsFor } from "./ysws";

const realFetch = globalThis.fetch;

function entry(over: Record<string, unknown> = {}) {
  return {
    ysws: "Some YSWS",
    approved_at: 1_700_000_000,
    hours: 5,
    code_url: "https://github.com/someone/thing",
    demo_url: "https://thing.example.com",
    description: "x",
    ...over,
  };
}

// Stands in for ships.hackclub.com. Counts calls so the caching/coalescing
// behaviour is observable, and can be made slow or failing on demand.
function stubArchive(entries: unknown[], opts: { fail?: boolean; delayMs?: number } = {}) {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail) throw new Error("boom");
    return new Response(JSON.stringify(entries), {
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return state;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  __resetArchiveForTests();
});

describe("yswsShipsFor", () => {
  test("matches on the repo url", async () => {
    stubArchive([entry()]);
    const ships = await yswsShipsFor(null, "https://github.com/someone/thing", null);
    expect(ships).toHaveLength(1);
    expect(ships[0]!.ysws).toBe("Some YSWS");
  });

  test("matches on the demo url, ignoring scheme/www/trailing slash", async () => {
    stubArchive([entry()]);
    const ships = await yswsShipsFor(null, null, "http://www.thing.example.com/");
    expect(ships).toHaveLength(1);
  });

  test("returns one row when repo and demo both hit the same archive entry", async () => {
    stubArchive([entry()]);
    const ships = await yswsShipsFor(
      null,
      "https://github.com/someone/thing",
      "https://thing.example.com",
    );
    expect(ships).toHaveLength(1);
  });

  test("skips the fetch entirely when there is nothing to match on", async () => {
    const archive = stubArchive([entry()]);
    expect(await yswsShipsFor(null, null, null)).toEqual([]);
    expect(archive.calls).toBe(0);
  });

  test("fetches the archive once for concurrent callers", async () => {
    const archive = stubArchive([entry()], { delayMs: 20 });
    await Promise.all([
      yswsShipsFor(null, "https://github.com/someone/thing", null),
      yswsShipsFor(null, "https://github.com/other/repo", null),
      yswsShipsFor(null, "https://github.com/third/repo", null),
    ]);
    expect(archive.calls).toBe(1);
  });

  test("serves the cached archive without refetching", async () => {
    const archive = stubArchive([entry()]);
    await yswsShipsFor(null, "https://github.com/someone/thing", null);
    await yswsShipsFor(null, "https://github.com/someone/thing", null);
    expect(archive.calls).toBe(1);
  });

  test("does not refetch on every call while the archive is failing", async () => {
    const archive = stubArchive([], { fail: true });
    expect(await yswsShipsFor(null, "https://github.com/someone/thing", null)).toEqual([]);
    expect(await yswsShipsFor(null, "https://github.com/someone/thing", null)).toEqual([]);
    expect(await yswsShipsFor(null, "https://github.com/someone/thing", null)).toEqual([]);
    expect(archive.calls).toBe(1);
  });

  test("keeps serving the last good archive when a later fetch fails", async () => {
    stubArchive([entry()]);
    await yswsShipsFor(null, "https://github.com/someone/thing", null);
    stubArchive([], { fail: true });
    const ships = await yswsShipsFor(null, "https://github.com/someone/thing", null);
    expect(ships).toHaveLength(1);
  });
});
