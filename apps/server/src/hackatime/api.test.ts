import { afterEach, expect, test } from "bun:test";
import { fetchTrackedSecondsBetween, fetchTrackedSecondsSince, uniqueProjectNames } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubSpans(calls: string[]) {
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ spans: [{ start_time: 2_000_000_000, end_time: 2_000_000_600 }] }));
  }) as unknown as typeof fetch;
}

test("uniqueProjectNames drops repeats and keeps order", () => {
  expect(uniqueProjectNames(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
});

test("repeated project names are counted once for tracked seconds since", async () => {
  const calls: string[] = [];
  stubSpans(calls);
  const total = await fetchTrackedSecondsSince("U1", null, ["proj", "proj", "proj"], 0);
  expect(total).toBe(600);
  expect(calls.length).toBe(1);
});

test("repeated project names are counted once for windowed tracked seconds", async () => {
  const calls: string[] = [];
  stubSpans(calls);
  const out = await fetchTrackedSecondsBetween("U1", null, ["proj", "proj"], [{ startUnix: 0, endUnix: 3_000_000_000 }]);
  expect(out.seconds[0]).toBe(600);
  expect(calls.length).toBe(1);
});
