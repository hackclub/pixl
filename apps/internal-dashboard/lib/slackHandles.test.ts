import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { slackHandle, slackHandles } from "./slack";

const realFetch = globalThis.fetch;
const realToken = process.env.SLACK_BOT_TOKEN;
let calls: string[] = [];
let respond: (user: string) => Promise<Response>;

const ok = (user: string, name: string) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, user: { name, profile: { display_name: name } } })));
const fail = () => Promise.resolve(new Response(JSON.stringify({ ok: false, error: "ratelimited" })));

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  calls = [];
  respond = (user) => ok(user, `h-${user}`);
  globalThis.fetch = mock(async (_url: unknown, init?: RequestInit) => {
    const user = new URLSearchParams(String(init?.body)).get("user") ?? "";
    calls.push(user);
    return respond(user);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = realToken;
});

test("concurrent lookups for one id share a single Slack call", async () => {
  const [a, b] = await Promise.all([slackHandle("U_DEDUPE"), slackHandle("U_DEDUPE")]);
  expect(a).toBe("@h-U_DEDUPE");
  expect(b).toBe("@h-U_DEDUPE");
  expect(calls).toEqual(["U_DEDUPE"]);
});

test("a fresh cached handle is served without another call", async () => {
  await slackHandle("U_FRESH");
  await slackHandle("U_FRESH");
  expect(calls).toEqual(["U_FRESH"]);
});

test("a stale handle is served instantly and a failed refresh keeps it", async () => {
  const now = spyOn(Date, "now");
  const t0 = 1_800_000_000_000;
  now.mockReturnValue(t0);
  expect(await slackHandle("U_STALE")).toBe("@h-U_STALE");
  now.mockReturnValue(t0 + 11 * 60_000);
  respond = fail;
  expect(await slackHandle("U_STALE")).toBe("@h-U_STALE");
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toEqual(["U_STALE", "U_STALE"]);
  now.mockReturnValue(t0 + 11 * 60_000 + 1000);
  expect(await slackHandle("U_STALE")).toBe("@h-U_STALE");
  now.mockRestore();
});

test("a failed first lookup is retried soon, not cached for ten minutes", async () => {
  const now = spyOn(Date, "now");
  const t0 = 1_900_000_000_000;
  now.mockReturnValue(t0);
  respond = fail;
  expect(await slackHandle("U_FAILS")).toBeNull();
  respond = (user) => ok(user, `h-${user}`);
  now.mockReturnValue(t0 + 31_000);
  await slackHandle("U_FAILS");
  await new Promise((r) => setTimeout(r, 20));
  expect(await slackHandle("U_FAILS")).toBe("@h-U_FAILS");
  now.mockRestore();
});

test("maxWaitMs returns without a slow lookup, which still lands in the cache", async () => {
  let release!: () => void;
  respond = (user) =>
    new Promise<Response>((resolve) => {
      release = () => resolve(new Response(JSON.stringify({ ok: true, user: { name: user, profile: { display_name: "slow" } } })));
    });
  const t = performance.now();
  const handles = await slackHandles(["U_SLOW"], { maxWaitMs: 30 });
  expect(performance.now() - t).toBeLessThan(500);
  expect(handles.has("U_SLOW")).toBe(false);
  release();
  expect(await slackHandle("U_SLOW")).toBe("@slow");
});

test("without maxWaitMs every handle is waited for", async () => {
  const handles = await slackHandles(["U_A", "U_B", null, undefined, "U_A"]);
  expect(handles.get("U_A")).toBe("@h-U_A");
  expect(handles.get("U_B")).toBe("@h-U_B");
  expect(handles.size).toBe(2);
});
