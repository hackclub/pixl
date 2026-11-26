import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.HACKATIME_CLIENT_ID ??= "ht-client";
process.env.HACKATIME_CLIENT_SECRET ??= "ht-secret";

const { issueSessionToken } = await import("../auth/session.js");
const { db } = await import("../db/pgCompat.js");
const { bearer, testAuthGate } = await import("../http/testkit.js");
const { hackatimeSlackIdFrom } = await import("../hackatime/api.js");
const { default: hackatimeRouter, statsCacheGet, statsCacheSet } = await import("./hackatime.js");

function chainable(result: { data: unknown; error: unknown }, onUpdate?: (payload: unknown) => void) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "maybeSingle", "single", "limit"]) chain[m] = () => chain;
  chain.update = (payload: unknown) => {
    onUpdate?.(payload);
    result = { data: [{ id: "ht-user" }], error: null };
    return chain;
  };
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Drives connect -> Hackatime consent -> callback, with Hackatime saying the
// token belongs to `hackatimeSlackId` and the Pixl account having `ownSlackId`.
async function connectAs(ownSlackId: string | null, hackatimeSlackId: string | null) {
  const updates: unknown[] = [];
  const realFrom = db.from;
  const realFetch = globalThis.fetch;
  db.from = ((table: string) =>
    chainable(
      { data: table === "users" ? { slack_id: ownSlackId } : null, error: null },
      (p) => updates.push(p),
    )) as unknown as typeof db.from;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "ht-token" }), { status: 200 });
    if (href.includes("/api/v1/authenticated/me"))
      return new Response(JSON.stringify(hackatimeSlackId ? { id: 1, slack_id: hackatimeSlackId } : { id: 1 }), { status: 200 });
    return realFetch(url as string, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use(testAuthGate());
  app.use(hackatimeRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const token = issueSessionToken({ client: "web", userId: "ht-user", displayName: "Ht" });
    const start = await realFetch(`${base}/api/hackatime/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ redirect: "https://pixl.hackclub.com/projects" }),
    });
    expect(start.status).toBe(200);
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state")!;
    const cb = await realFetch(`${base}/hackatime/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    expect(cb.status).toBe(302);
    const location = new URL(cb.headers.get("location")!);
    return {
      outcome: location.searchParams.get("hackatime"),
      reason: location.searchParams.get("hackatime_reason"),
      updates,
    };
  } finally {
    db.from = realFrom;
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Hackatime connect identity binding", () => {
  test("the player's own Hackatime account is connected", async () => {
    const r = await connectAs("U0123ABCD", "U0123ABCD");
    expect(r.outcome).toBe("connected");
    expect(r.reason).toBeNull();
    expect(r.updates).toEqual([{ hackatime_token: "ht-token" }]);
  });

  test("someone else's Hackatime token is never stored", async () => {
    const r = await connectAs("U0123ABCD", "U9999ZZZZ");
    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("account_mismatch");
    expect(r.updates).toHaveLength(0);
  });

  test("an unknown Hackatime identity or an account with no Slack ID fails closed", async () => {
    const unknown = await connectAs("U0123ABCD", null);
    expect(unknown.updates).toHaveLength(0);
    expect(unknown.reason).toBe("no_slack_id");
    const noOwner = await connectAs(null, "U0123ABCD");
    expect(noOwner.updates).toHaveLength(0);
    expect(noOwner.reason).toBe("account_mismatch");
  });

  test("identity parsing", () => {
    expect(hackatimeSlackIdFrom({ slack_id: "U0123ABCD" })).toBe("U0123ABCD");
    expect(hackatimeSlackIdFrom({ user: { slack_uid: "U0123ABCD" } })).toBe("U0123ABCD");
    expect(hackatimeSlackIdFrom({ slack_id: "" })).toBeNull();
    expect(hackatimeSlackIdFrom({ slack_id: "u-lower<script>" })).toBeNull();
    expect(hackatimeSlackIdFrom(null)).toBeNull();
  });
});

describe("Hackatime stats cache", () => {
  test("entries live for a minute", () => {
    statsCacheSet("u1:", { n: 1 }, 1_000);
    expect(statsCacheGet("u1:", 30_000)).toEqual({ n: 1 });
    expect(statsCacheGet("u1:", 61_000)).toBeUndefined();
  });
});
