import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { issueSessionToken, verifySessionToken } from "../auth/session.js";
import { db } from "../db/pgCompat.js";
import authRouter from "./auth.js";
import projectsRouter from "./projects.js";

// These tests log in and then ship, so they depend on the event submission
// deadline. Pin the clock before it instead of breaking when the deadline passes.
beforeAll(() => setSystemTime(new Date("2026-11-15T12:00:00.000Z")));
afterAll(() => setSystemTime());

type Row = Record<string, unknown>;

// slow commit
const COMMIT_TURNS = 3;

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface WriteRecord {
  payload: Row;
  failed: boolean;
}

interface WorldOptions {
  users: Row[];
  failWrite?: (payload: Row) => boolean;
}

function createWorld(opts: WorldOptions) {
  const rows = opts.users.map((r) => ({ ...r }));
  const writes: WriteRecord[] = [];
  const realFrom = db.from;

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

  function usersChain() {
    const filters: Record<string, unknown> = {};
    let single = false;
    let updatePayload: Row | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      single: () => {
        single = true;
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      update: (payload: Row) => {
        updatePayload = payload;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        run().then(resolve, reject),
    };
    const matches = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
    async function run(): Promise<{ data: unknown; error: unknown }> {
      if (updatePayload) {
        const payload = updatePayload;
        const failed = opts.failWrite?.(payload) ?? false;
        writes.push({ payload, failed });
        if (failed) return { data: null, error: { message: "simulated write failure", code: "57014" } };
        for (let i = 0; i < COMMIT_TURNS; i++) await turn();
        for (const row of matches()) Object.assign(row, payload);
        return { data: null, error: null };
      }
      const found = matches().map((r) => ({ ...r }));
      return { data: single ? (found[0] ?? null) : found, error: null };
    }
    return chain;
  }

  db.from = ((table: string) => {
    if (table === "users") return usersChain();
    if (table === "projects")
      return chainable({ data: { id: 1, user_id: "user-1", name: "Draft", status: "draft", repo_url: null }, error: null });
    return chainable({ data: [], error: null });
  }) as unknown as typeof db.from;

  return {
    writes,
    committed: (id: string) => rows.find((r) => r.id === id),
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

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;
interface RouterLike {
  stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } }[];
}

function routeStack(router: unknown, method: "get" | "post", path: string): Handler[] {
  const layer = (router as RouterLike).stack.find((l) => l.route?.path === path && l.route.methods[method]);
  if (!layer?.route) throw new Error(`no ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.map((l) => l.handle);
}

interface FakeOut {
  status: number;
  location: string | null;
  body: string;
  headers: Record<string, string>;
}

interface FakeReq {
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  // What the global auth gate (http/gate.ts) would have attached.
  session?: { userId: string; displayName: string; iat: number };
}

// Runs every handler on the route (validate(), requireSession(), the
// handler itself) in order, with just enough of req/res for them.
async function callRoute(router: unknown, method: "get" | "post", path: string, req: FakeReq = {}): Promise<FakeOut> {
  const out: FakeOut = { status: 200, location: null, body: "", headers: {} };
  let finished = false;
  const res: Record<string, unknown> = {};
  res.status = (code: number) => {
    out.status = code;
    return res;
  };
  const setHeader = (k: string, v: string) => {
    out.headers[k.toLowerCase()] = String(v);
    return res;
  };
  res.set = setHeader;
  res.setHeader = setHeader;
  res.header = setHeader;
  res.type = () => res;
  res.send = (b: unknown) => {
    out.body = String(b ?? "");
    finished = true;
    return res;
  };
  res.json = (b: unknown) => {
    out.body = JSON.stringify(b);
    finished = true;
    return res;
  };
  res.redirect = (a: number | string, b?: string) => {
    out.status = typeof a === "number" ? a : 302;
    out.location = typeof a === "number" ? (b ?? null) : a;
    finished = true;
    return res;
  };
  const fakeReq: Record<string, unknown> = {
    method: method.toUpperCase(),
    query: req.query ?? {},
    params: req.params ?? {},
    body: req.body ?? {},
    headers: req.headers ?? {},
    socket: {},
    ...(req.session ? { session: req.session } : {}),
  };
  for (const handle of routeStack(router, method, path)) {
    let advanced = false;
    let failure: unknown;
    await handle(fakeReq, res, (err?: unknown) => {
      advanced = true;
      failure = err;
    });
    // requireSession() chains async middlewares; give them a moment.
    for (let i = 0; i < 20 && !advanced && !finished; i++) await turn();
    if (failure) throw failure;
    if (finished || !advanced) break;
  }
  return out;
}

const PLAY = "https://play.pixl.hackclub.com";
const CLIENT_STATE = "client-state-0123456789";

async function startLogin(query: Record<string, string>) {
  const out = await callRoute(authRouter, "get", "/auth/hackclub", { query });
  return new URL(out.location!).searchParams.get("state")!;
}

async function finishLogin(state: string) {
  return callRoute(authRouter, "get", "/auth/hackclub/callback", { query: { code: "fake-code", state } });
}

async function login(query: Record<string, string>) {
  return finishLogin(await startLogin(query));
}

// What the game does with the login redirect: trade the code for a token.
async function tokenFrom(location: string | null): Promise<string> {
  const code = new URL(location!).searchParams.get("code") ?? "";
  const out = await callRoute(authRouter, "post", "/auth/exchange", {
    headers: { origin: PLAY },
    body: { code },
  });
  return out.status === 200 ? ((JSON.parse(out.body) as { token: string }).token ?? "") : "";
}

function ship(token: string) {
  const session = verifySessionToken(token);
  return callRoute(projectsRouter, "post", "/api/projects/:id/ship", {
    params: { id: "1" },
    body: {},
    ...(session ? { session } : {}),
  });
}

const HCA_ID = "hca-1";
const RETURN_TO = "https://pixl.hackclub.com/projects/";
const START = { redirect: `${PLAY}/`, state: CLIENT_STATE };

const verified = { id: HCA_ID, first_name: "Player", last_name: "One", verification_status: "verified", ysws_eligible: true };

function existingUser(state: Row = {}): Row {
  return {
    id: "user-1",
    oauth_provider: "hackclub",
    oauth_id: HCA_ID,
    display_name: "Player",
    real_name: "Player One",
    avatar_url: "https://example.com/a.png",
    hca_verification_status: null,
    hca_ysws_eligible: null,
    ...state,
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function setup(users: Row[], identity: Row, opts: Partial<WorldOptions> = {}) {
  const world = createWorld({ users, ...opts });
  const hca = mockHcaFetch(identity);
  cleanups.push(world.restore, hca.restore);
  return world;
}

const errorOf = (body: string) => (JSON.parse(body) as { error?: string }).error;
const writesHca = (payload: Row) => "hca_verification_status" in payload || "hca_ysws_eligible" in payload;

describe("login stores fresh HCA state before it hands out a session", () => {
  test.each([
    ["never captured", {}],
    ["pending", { hca_verification_status: "pending" }],
    ["needs_submission", { hca_verification_status: "needs_submission" }],
  ])("a %s account that verified on HCA can ship the instant login returns", async (_name, stale) => {
    setup([existingUser(stale)], verified);
    const done = await login(START);
    expect(done.status).toBe(302);
    const r = await ship(await tokenFrom(done.location));
    expect(r.status).toBe(400);
    expect(errorOf(r.body)).toBe("repo_required");
  });

  test("a downgrade reported by HCA replaces a stored verified state", async () => {
    setup(
      [existingUser({ hca_verification_status: "verified", hca_ysws_eligible: true })],
      { id: HCA_ID, first_name: "Player", last_name: "One", verification_status: "pending" },
    );
    const done = await login(START);
    expect(done.status).toBe(302);
    const r = await ship(await tokenFrom(done.location));
    expect(r.status).toBe(403);
    expect(errorOf(r.body)).toBe("hca_verification_required");
  });

  test("a login that cannot save the fresh HCA state does not sign the user in", async () => {
    const world = setup([existingUser()], verified, { failWrite: writesHca });
    const done = await login(START);
    expect(done.status).toBe(503);
    expect(done.location).toBeNull();
    expect(done.body).not.toContain("code=");
    expect(done.headers["retry-after"]).toBeTruthy();
    expect(done.body).toContain(`state=${CLIENT_STATE}`);
    expect(world.committed("user-1")?.hca_verification_status).toBeNull();
  });

  test("a failing profile backfill neither blocks login nor loses the HCA state", async () => {
    setup([existingUser()], verified, { failWrite: (p) => "real_name" in p });
    const done = await login(START);
    expect(done.status).toBe(302);
    const r = await ship(await tokenFrom(done.location));
    expect(errorOf(r.body)).toBe("repo_required");
  });

  test("an unchanged HCA state does not add a security write", async () => {
    const world = setup([existingUser({ hca_verification_status: "verified", hca_ysws_eligible: true })], verified);
    const done = await login(START);
    expect(done.status).toBe(302);
    expect(world.writes.some((w) => writesHca(w.payload))).toBe(false);
  });

  test("an HCA response with no verification status leaves stored state alone and says so", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const world = setup([existingUser()], { id: HCA_ID, first_name: "Player", last_name: "One" });
      const done = await login(START);
      expect(done.status).toBe(302);
      expect(world.writes.some((w) => writesHca(w.payload))).toBe(false);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("verification_status"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("POST /auth/flow/resync", () => {
  const token = () => issueSessionToken({ client: "web", userId: "user-1", displayName: "Player" });
  const start = (redirect: string, t?: string) =>
    callRoute(authRouter, "post", "/auth/flow/:name", {
      params: { name: "resync" },
      body: { redirect },
      headers: t ? { authorization: `Bearer ${t}` } : {},
    });
  const stateOf = (body: string) => new URL((JSON.parse(body) as { url: string }).url).searchParams.get("state")!;

  test("needs a session", async () => {
    setup([existingUser()], verified);
    expect((await start(RETURN_TO)).status).toBe(401);
  });

  test("refuses a redirect target that is not allowed", async () => {
    setup([existingUser()], verified);
    expect((await start("https://evil.example/", token())).status).toBe(400);
  });

  test("re-checks HCA for the signed-in account, unlocks shipping at once, and issues no new session", async () => {
    setup([existingUser()], verified);
    const t = token();
    const begun = await start(RETURN_TO, t);
    expect(begun.status).toBe(200);
    expect(begun.body).toContain("https://auth.hackclub.com/oauth/authorize");
    expect(begun.body).not.toContain(t);
    const done = await finishLogin(stateOf(begun.body));
    expect(done.status).toBe(302);
    const dest = new URL(done.location!);
    expect(dest.origin + dest.pathname).toBe(RETURN_TO);
    expect(dest.searchParams.get("hca_synced")).toBe("verified");
    expect(dest.searchParams.has("token")).toBe(false);
    expect(dest.searchParams.has("code")).toBe(false);
    const r = await ship(t);
    expect(errorOf(r.body)).toBe("repo_required");
  });

  test("reports pending without unlocking shipping", async () => {
    setup([existingUser()], { id: HCA_ID, first_name: "Player", last_name: "One", verification_status: "pending" });
    const t = token();
    const begun = await start(RETURN_TO, t);
    const done = await finishLogin(stateOf(begun.body));
    expect(new URL(done.location!).searchParams.get("hca_synced")).toBe("pending");
    const r = await ship(t);
    expect(r.status).toBe(403);
    expect(errorOf(r.body)).toBe("hca_verification_required");
  });

  test("a different HCA identity cannot write eligibility onto this account", async () => {
    const world = setup([existingUser()], { ...verified, id: "someone-else" });
    const begun = await start(RETURN_TO, token());
    const done = await finishLogin(stateOf(begun.body));
    expect(done.status).toBe(403);
    expect(done.location).toBeNull();
    expect(world.writes.some((w) => writesHca(w.payload))).toBe(false);
    expect(world.committed("user-1")?.hca_verification_status).toBeNull();
  });

  test("a state that cannot be saved is a retryable error, not a redirect", async () => {
    const world = setup([existingUser()], verified, { failWrite: writesHca });
    const begun = await start(RETURN_TO, token());
    const done = await finishLogin(stateOf(begun.body));
    expect(done.status).toBe(503);
    expect(done.location).toBeNull();
    expect(done.headers["retry-after"]).toBeTruthy();
    expect(world.committed("user-1")?.hca_verification_status).toBeNull();
  });
});
