import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { verifySessionToken } from "../auth/session.js";
import { db } from "../db/pgCompat.js";
import authRouter from "./auth.js";

async function startTestApp() {
  const app = express();
  app.use(authRouter);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function chainable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is",
    "contains", "not", "match", "or", "order", "limit", "range", "insert",
    "upsert", "update", "delete", "single", "maybeSingle",
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Simulates the exact race: the pre-insert lookup finds nothing (both
// concurrent requests see this), the insert then hits the unique constraint
// from drizzle/0177_users_oauth_unique.sql (the "other" concurrent request
// won), and the code should fall back to fetching the row that won instead
// of 500ing.
function mockUsersRace(oauthProvider: string, winnerRow: Record<string, unknown>) {
  const realFrom = db.from;
  let usersCalls = 0;
  db.from = ((table: string) => {
    if (table !== "users") return chainable({ data: [], error: null }) as ReturnType<typeof realFrom>;
    usersCalls++;
    if (usersCalls === 1) return chainable({ data: [], error: null }) as ReturnType<typeof realFrom>;
    if (usersCalls === 2)
      return chainable({
        data: null,
        error: { code: "23505", message: `duplicate key value violates "users_oauth_provider_oauth_id_key"` },
      }) as ReturnType<typeof realFrom>;
    return chainable({ data: winnerRow, error: null }) as ReturnType<typeof realFrom>;
  }) as typeof db.from;
  return {
    usersInsertAttempts: () => usersCalls,
    restore: () => {
      db.from = realFrom;
    },
  };
}

function mockHcaFetch(identity: Record<string, unknown>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/oauth/token")) {
      return new Response(
        JSON.stringify({ access_token: "fake-token", token_type: "bearer", expires_in: 3600, refresh_token: "r", scope: "" }),
        { status: 200 },
      );
    }
    if (href.includes("/api/v1/me")) {
      return new Response(JSON.stringify({ identity, scopes: [] }), { status: 200 });
    }
    return realFetch(url as string, init);
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

describe("GET /auth/hackclub/callback", () => {
  test("a losing concurrent signup logs into the winner's account instead of 500ing", async () => {
    const winnerRow = {
      id: "winner-user-id",
      oauth_provider: "hackclub",
      oauth_id: "hca-race-identity",
      display_name: "Race Winner",
      real_name: "Race Winner",
    };
    const race = mockUsersRace("hackclub", winnerRow);
    const hca = mockHcaFetch({ id: "hca-race-identity", first_name: "Race", last_name: "Winner" });
    const app = await startTestApp();
    try {
      const startRes = await fetch(`${app.baseUrl}/auth/hackclub`, { redirect: "manual" });
      const location = startRes.headers.get("location")!;
      const state = new URL(location).searchParams.get("state")!;

      const callbackRes = await fetch(
        `${app.baseUrl}/auth/hackclub/callback?code=fake-code&state=${state}`,
        { redirect: "manual" },
      );

      expect(callbackRes.status).toBe(302);
      const redirectTarget = new URL(callbackRes.headers.get("location")!);
      const token = redirectTarget.searchParams.get("token")!;
      const session = verifySessionToken(token);
      expect(session?.userId).toBe("winner-user-id");
      // Never claims the "new signup" path for the race's loser.
      expect(redirectTarget.searchParams.get("new")).not.toBe("1");
      // select (miss) -> insert (23505) -> select (post-race refetch)
      expect(race.usersInsertAttempts()).toBe(3);
    } finally {
      race.restore();
      hca.restore();
      await app.close();
    }
  });
});

describe("GET /auth/demo", () => {
  const originalAllowDemo = process.env.ALLOW_DEMO_LOGIN;
  afterEach(() => {
    if (originalAllowDemo === undefined) delete process.env.ALLOW_DEMO_LOGIN;
    else process.env.ALLOW_DEMO_LOGIN = originalAllowDemo;
  });

  test("a losing concurrent demo signup logs into the winner's account instead of 500ing", async () => {
    process.env.ALLOW_DEMO_LOGIN = "true";
    const winnerRow = {
      id: "demo-winner-id",
      oauth_provider: "demo",
      oauth_id: "demo_race",
      display_name: "race",
    };
    const race = mockUsersRace("demo", winnerRow);
    const app = await startTestApp();
    try {
      const res = await fetch(`${app.baseUrl}/auth/demo?name=race`);
      const body = (await res.json()) as { token: string; name: string };

      expect(res.status).toBe(200);
      const session = verifySessionToken(body.token);
      expect(session?.userId).toBe("demo-winner-id");
      expect(race.usersInsertAttempts()).toBe(3);
    } finally {
      race.restore();
      await app.close();
    }
  });
});
