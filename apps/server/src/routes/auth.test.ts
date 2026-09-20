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
// concurrent requests see this), the insert then hits a unique constraint
// (the "other" concurrent request won), and the code should fall back to
// fetching the row that won instead of 500ing - but only when the constraint
// that fired is actually users_oauth_provider_oauth_id_key (drizzle/
// 0177_users_oauth_unique.sql), not just any 23505 on `users` (it already has
// another unique constraint, on referral_code).
function mockUsersRace(
  winnerRow: Record<string, unknown>,
  constraintName = "users_oauth_provider_oauth_id_key",
) {
  const realFrom = db.from;
  let usersCalls = 0;
  db.from = ((table: string) => {
    if (table !== "users") return chainable({ data: [], error: null }) as ReturnType<typeof realFrom>;
    usersCalls++;
    if (usersCalls === 1) return chainable({ data: [], error: null }) as ReturnType<typeof realFrom>;
    if (usersCalls === 2)
      return chainable({
        data: null,
        error: {
          code: "23505",
          message: `duplicate key value violates unique constraint "${constraintName}"`,
          constraintName,
        },
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

// A plain in-memory users table for the non-race paths: a real select-miss
// then insert-success (new signup), or a select-hit (existing login), with
// state that's actually consistent between calls - unlike mockUsersRace,
// which deliberately makes select and insert disagree to simulate a race.
function mockUsersTable(initialRows: Record<string, unknown>[] = []) {
  const realFrom = db.from;
  const rows = [...initialRows];
  const inserted: Record<string, unknown>[] = [];
  let nextId = 1;

  function usersChain() {
    let filters: Record<string, unknown> = {};
    let insertPayload: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters = { ...filters, [col]: val };
        return chain;
      },
      limit: () => chain,
      single: () => chain,
      maybeSingle: () => chain,
      insert: (row: Record<string, unknown>) => {
        insertPayload = row;
        return chain;
      },
      // The existing-user branch fires a fire-and-forget backfill update
      // (slack_id/email/name sync) - not under test here, just needs to
      // resolve cleanly instead of throwing on a missing chain method.
      update: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        let result: { data: unknown; error: unknown };
        if (insertPayload) {
          const row = { id: `user-${nextId++}`, ...insertPayload };
          rows.push(row);
          inserted.push(row);
          result = { data: row, error: null };
        } else {
          const matches = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v),
          );
          result = { data: matches, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  }

  db.from = ((table: string) => {
    if (table === "users") return usersChain() as ReturnType<typeof realFrom>;
    return chainable({ data: [], error: null }) as ReturnType<typeof realFrom>;
  }) as typeof db.from;

  return {
    insertedRows: () => inserted,
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

async function driveHcaCallback(baseUrl: string, startQuery = "") {
  const startRes = await fetch(`${baseUrl}/auth/hackclub${startQuery}`, { redirect: "manual" });
  const location = startRes.headers.get("location")!;
  const state = new URL(location).searchParams.get("state")!;
  return fetch(`${baseUrl}/auth/hackclub/callback?code=fake-code&state=${state}`, {
    redirect: "manual",
  });
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
    const race = mockUsersRace(winnerRow);
    const hca = mockHcaFetch({ id: "hca-race-identity", first_name: "Race", last_name: "Winner" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl);

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

  test("a 23505 on an unrelated constraint still 500s instead of being treated as the identity race", async () => {
    // users also has a unique constraint on referral_code (drizzle/
    // 0073_referrals.sql) - a 23505 from that has nothing to do with the
    // signup race and must not be swallowed into a fake "login succeeded".
    const race = mockUsersRace(
      { id: "should-not-be-used" },
      "users_referral_code_key",
    );
    const hca = mockHcaFetch({ id: "hca-unrelated-conflict", first_name: "Some", last_name: "Body" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl);

      expect(callbackRes.status).toBe(500);
      // Never reached the post-race refetch - only lookup + failed insert.
      expect(race.usersInsertAttempts()).toBe(2);
    } finally {
      race.restore();
      hca.restore();
      await app.close();
    }
  });

  test("a brand new HCA identity creates exactly one account and is flagged as a new signup", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-fresh-identity", first_name: "Fresh", last_name: "User" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl);

      expect(callbackRes.status).toBe(302);
      const redirectTarget = new URL(callbackRes.headers.get("location")!);
      expect(redirectTarget.searchParams.get("new")).toBe("1");
      const token = redirectTarget.searchParams.get("token")!;
      const session = verifySessionToken(token);
      expect(session?.userId).toBe(users.insertedRows()[0]?.id);
      // Exactly one users row ever gets created for this identity.
      expect(users.insertedRows()).toHaveLength(1);
      expect(users.insertedRows()[0]?.oauth_id).toBe("hca-fresh-identity");
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("an already-registered HCA identity logs into the same account without inserting", async () => {
    const users = mockUsersTable([
      {
        id: "existing-user-id",
        oauth_provider: "hackclub",
        oauth_id: "hca-existing-identity",
        display_name: "Returning Player",
        real_name: "Returning Player",
        avatar_url: "https://example.com/avatar.png",
      },
    ]);
    const hca = mockHcaFetch({ id: "hca-existing-identity", first_name: "Returning", last_name: "Player" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl);

      expect(callbackRes.status).toBe(302);
      const redirectTarget = new URL(callbackRes.headers.get("location")!);
      const token = redirectTarget.searchParams.get("token")!;
      const session = verifySessionToken(token);
      expect(session?.userId).toBe("existing-user-id");
      expect(redirectTarget.searchParams.get("new")).not.toBe("1");
      // No new row was ever created for a login that already had one.
      expect(users.insertedRows()).toHaveLength(0);
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });
});

// The initial display_name on signup comes from HCA/Slack, sources the
// player doesn't control the character set of. A later rename rejects a
// bad name via nameProblem() (routes/profile.ts) , signup must run the
// same check or a nasty/malformed name slips in before any rename ever
// happens.
describe("GET /auth/hackclub/callback -> new signup display_name validation", () => {
  const FALLBACK_PATTERN = /^user_[a-zA-Z0-9]{1,8}$/;

  test("a normal HCA name is stored as-is", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-name-ok", first_name: "Ada", last_name: "Lovelace" });
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      expect(users.insertedRows()[0]?.display_name).toBe("Ada Lovelace");
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("a <script> tag in the HCA name never reaches display_name", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-name-xss", first_name: "<script>alert(1)</script>" });
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      const stored = users.insertedRows()[0]?.display_name as string;
      expect(stored).not.toContain("<script>");
      expect(stored).toMatch(FALLBACK_PATTERN);
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("a nasty Slack fallback name never reaches display_name", async () => {
    const users = mockUsersTable([]);
    const originalToken = process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_BOT_TOKEN = "fake-token";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "fake-token",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "r",
            scope: "",
          }),
          { status: 200 },
        );
      }
      if (href.includes("/api/v1/me")) {
        return new Response(
          JSON.stringify({
            identity: { id: "hca-slack-nasty", slack_id: "U999NASTY" },
            scopes: [],
          }),
          { status: 200 },
        );
      }
      if (href.includes("slack.com/api/users.info")) {
        return new Response(
          JSON.stringify({ ok: true, user: { real_name: "<img src=x onerror=alert(1)>" } }),
          { status: 200 },
        );
      }
      return realFetch(url as string, init);
    }) as typeof fetch;
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      const stored = users.insertedRows()[0]?.display_name as string;
      expect(stored).not.toContain("<img");
      expect(stored).toMatch(FALLBACK_PATTERN);
    } finally {
      globalThis.fetch = realFetch;
      if (originalToken === undefined) delete process.env.SLACK_BOT_TOKEN;
      else process.env.SLACK_BOT_TOKEN = originalToken;
      users.restore();
      await app.close();
    }
  });

  test("a name over 24 characters falls back to the generated placeholder", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({
      id: "hca-name-long",
      first_name: "Reallylongfirstnamehere",
      last_name: "AndAnEvenLongerLastName",
    });
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      const stored = users.insertedRows()[0]?.display_name as string;
      expect(stored.length).toBeLessThanOrEqual(24);
      expect(stored).toMatch(FALLBACK_PATTERN);
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("a valid Unicode name is stored as-is", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-name-unicode", first_name: "José", last_name: "García" });
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      expect(users.insertedRows()[0]?.display_name).toBe("José García");
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("a blocked word in the HCA name falls back to the generated placeholder", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-name-blocked", first_name: "idiot" });
    const app = await startTestApp();
    try {
      await driveHcaCallback(app.baseUrl);
      const stored = users.insertedRows()[0]?.display_name as string;
      expect(stored).not.toBe("idiot");
      expect(stored).toMatch(FALLBACK_PATTERN);
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });
});

// F-8: apps/web-shell's proxy.ts must be able to tell a genuine login
// round trip apart from an arbitrary ?token= on a link. It does that by
// requiring ?ln= to match a cookie it set itself before the browser ever
// left for this flow - this only proves this server's half: a nonce handed
// to /auth/hackclub comes back unchanged on the callback's final redirect.
describe("GET /auth/hackclub -> callback (F-8 login nonce round-trip)", () => {
  test("a nonce passed to /auth/hackclub comes back as ln= on the final redirect", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-nonce-identity", first_name: "Nonce", last_name: "Tester" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl, "?nonce=abc123def456");

      expect(callbackRes.status).toBe(302);
      const redirectTarget = new URL(callbackRes.headers.get("location")!);
      expect(redirectTarget.searchParams.get("ln")).toBe("abc123def456");
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });

  test("no nonce means no ln= on the final redirect (the Godot client's flow, unaffected)", async () => {
    const users = mockUsersTable([]);
    const hca = mockHcaFetch({ id: "hca-no-nonce-identity", first_name: "No", last_name: "Nonce" });
    const app = await startTestApp();
    try {
      const callbackRes = await driveHcaCallback(app.baseUrl);

      expect(callbackRes.status).toBe(302);
      const redirectTarget = new URL(callbackRes.headers.get("location")!);
      expect(redirectTarget.searchParams.has("ln")).toBe(false);
    } finally {
      users.restore();
      hca.restore();
      await app.close();
    }
  });
});

describe("GET /auth/hackclub/callback retry link keeps the login nonce", () => {
  test("a throttled token exchange offers a retry that still carries the nonce", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) return new Response("slow your roll!", { status: 429 });
      return realFetch(url as string, init);
    }) as typeof fetch;
    const app = await startTestApp();
    try {
      const redirect = encodeURIComponent("https://pixl.hackclub.com/shop/");
      const res = await driveHcaCallback(app.baseUrl, `?web_redirect=${redirect}&nonce=abc123def456`);
      expect(res.status).toBe(429);
      const html = await res.text();
      const href = /href="([^"]+)"/.exec(html)![1];
      const retry = new URL(href, "http://x");
      expect(retry.pathname).toBe("/auth/hackclub");
      expect(retry.searchParams.get("web_redirect")).toBe("https://pixl.hackclub.com/shop/");
      expect(retry.searchParams.get("nonce")).toBe("abc123def456");
    } finally {
      globalThis.fetch = realFetch;
      await app.close();
    }
  });

  test("without a nonce the retry link has none", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/oauth/token")) return new Response("boom", { status: 500 });
      return realFetch(url as string, init);
    }) as typeof fetch;
    const app = await startTestApp();
    try {
      const res = await driveHcaCallback(app.baseUrl);
      const href = /href="([^"]+)"/.exec(await res.text())![1];
      expect(href).toBe("/auth/hackclub");
    } finally {
      globalThis.fetch = realFetch;
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
    const race = mockUsersRace(winnerRow);
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

  test("a normal demo login reuses the same account on a second request instead of creating another", async () => {
    process.env.ALLOW_DEMO_LOGIN = "true";
    const users = mockUsersTable([]);
    const app = await startTestApp();
    try {
      const first = await fetch(`${app.baseUrl}/auth/demo?name=normal-demo-player`);
      const firstBody = (await first.json()) as { token: string };
      const firstSession = verifySessionToken(firstBody.token);

      const second = await fetch(`${app.baseUrl}/auth/demo?name=normal-demo-player`);
      const secondBody = (await second.json()) as { token: string };
      const secondSession = verifySessionToken(secondBody.token);

      expect(firstSession?.userId).toBe(secondSession?.userId);
      // One signup, one login - not two accounts for the same demo identity.
      expect(users.insertedRows()).toHaveLength(1);
    } finally {
      users.restore();
      await app.close();
    }
  });
});
