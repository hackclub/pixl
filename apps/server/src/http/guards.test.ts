import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { z } from "zod";
import { issueSessionToken } from "../auth/session.js";
import { resetAuditThrottle, setAuditWriter, type AuditRow } from "../audit.js";
import { ALLOWED_ORIGINS, isAllowedOrigin, originGuard } from "./origins.js";
import { isPublicRoute, PUBLIC_ROUTES } from "./publicRoutes.js";
import { adminServiceGate, matchServiceKey, MIN_SERVICE_KEY_LENGTH } from "./serviceKeys.js";
import { authGate, auditApiRequests } from "./gate.js";
import { bearerToken } from "./bearer.js";
import { validate, v, params } from "./validate.js";

const audits: AuditRow[] = [];
setAuditWriter(async (row) => void audits.push(row));

const DASH_KEY = "a".repeat(48);
const INTERNAL_KEY = "b".repeat(48);
const PIXO_KEY = "c".repeat(48);
const keys = {
  SERVICE_KEY_PIXL_DASHBOARD: DASH_KEY,
  SERVICE_KEY_INTERNAL_DASHBOARD: INTERNAL_KEY,
  SERVICE_KEY_PIXO: PIXO_KEY,
};

// The same middleware order index.ts uses, minus rate limits and the real
// routers, with the DB-backed revocation/ban lookups stubbed out.
let server: Server;
let base = "";
const revoked = new Set<string>();
const banned = new Set<string>();

beforeAll(async () => {
  const app = express();
  app.use(originGuard());
  app.use(express.json({ limit: "256kb" }));
  app.use(auditApiRequests());
  app.use("/api/admin", adminServiceGate(keys));
  app.use(
    authGate({
      revokedAt: async (userId) => ({ ok: true, revokedAtMs: revoked.has(userId) ? Date.now() + 60_000 : null }),
      banState: async (userId) => (banned.has(userId) ? "banned" : "clear"),
    }),
  );
  app.get("/", (_req, res) => res.json({ ok: true }));
  app.get("/api/news", (_req, res) => res.json({ ok: true, news: [] }));
  app.get("/api/explore/players/:id/public", (_req, res) => res.json({ ok: true }));
  app.get("/api/me", (req, res) => res.json({ ok: true, userId: req.session?.userId, client: req.session?.client }));
  app.post(
    "/api/things/:id",
    validate({ params: params({ id: v.id }), query: v.noQuery, body: z.object({ name: z.string().max(5) }) }),
    (req, res) => res.json({ ok: true, body: req.body, id: req.params.id }),
  );
  app.get("/api/admin/online", (req, res) => res.json({ ok: true, service: req.service }));
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  setAuditWriter(null);
  await new Promise<void>((r) => server.close(() => r()));
});

const tokenFor = (userId: string) => issueSessionToken({ client: "web", userId, displayName: "T" });
const flush = () => new Promise((r) => setTimeout(r, 5));

describe("origin allowlist", () => {
  test("exactly the site, play and dash origins", () => {
    expect([...ALLOWED_ORIGINS]).toEqual([
      "https://pixl.hackclub.com",
      "https://play.pixl.hackclub.com",
      "https://dash.pixl.hackclub.com",
    ]);
    for (const bad of ["http://localhost:3000", "https://evil.example", "null", "", "https://pixl.hackclub.com.evil.example"])
      expect(isAllowedOrigin(bad)).toBe(false);
  });

  test("an allowed origin is echoed with Vary: Origin and no credentials header", async () => {
    const res = await fetch(`${base}/api/news`, { headers: { Origin: "https://play.pixl.hackclub.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://play.pixl.hackclub.com");
    expect(res.headers.get("vary")).toContain("Origin");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type, Authorization");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("a disallowed origin is a 403 and an origin.rejected audit row", async () => {
    audits.length = 0;
    resetAuditThrottle();
    const res = await fetch(`${base}/api/news`, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    await flush();
    expect(audits.some((a) => a.action === "origin.rejected" && a.result === "denied")).toBe(true);
  });

  test("a preflight from an allowed origin is answered without auth", async () => {
    const res = await fetch(`${base}/api/me`, { method: "OPTIONS", headers: { Origin: "https://pixl.hackclub.com" } });
    expect(res.status).toBe(204);
  });

  test("no Origin passes the origin layer (server-to-server) but still needs auth", async () => {
    expect((await fetch(`${base}/api/news`)).status).toBe(200);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });
});

describe("public route list", () => {
  test("matches the spec exactly", () => {
    expect(PUBLIC_ROUTES.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      "GET /",
      "GET /health",
      "* /auth/*",
      "GET /hackatime/callback",
      "GET /api/news",
      "GET /api/results",
      "GET /api/journals/public/:projectId/:token",
      "GET /api/shop/item/:id/public",
      "GET /api/explore/players",
      "GET /api/explore/players/:id/public",
      "GET /api/explore/projects",
      "GET /api/explore/projects/:id",
      "* /api/forms/*",
    ]);
  });

  test("matching", () => {
    expect(isPublicRoute("GET", "/")).toBe(true);
    expect(isPublicRoute("HEAD", "/health")).toBe(true);
    expect(isPublicRoute("POST", "/auth/exchange")).toBe(true);
    expect(isPublicRoute("GET", "/api/journals/public/12/abc")).toBe(true);
    expect(isPublicRoute("GET", "/api/explore/players/u1/public")).toBe(true);
    expect(isPublicRoute("GET", "/api/explore/projects")).toBe(true);
    expect(isPublicRoute("GET", "/api/explore/projects/644")).toBe(true);
    expect(isPublicRoute("POST", "/api/forms/review/submit")).toBe(true);
    expect(isPublicRoute("GET", "/API/News/")).toBe(true);

    expect(isPublicRoute("POST", "/api/news")).toBe(false);
    expect(isPublicRoute("GET", "/api/explore/players/u1")).toBe(false);
    // Reading a project is public; voting on one and its other sub-paths are not.
    expect(isPublicRoute("POST", "/api/explore/projects")).toBe(false);
    expect(isPublicRoute("GET", "/api/explore/projects/644/anything")).toBe(false);
    expect(isPublicRoute("POST", "/api/projects/644/upvote")).toBe(false);
    expect(isPublicRoute("GET", "/api/journals/public/12")).toBe(false);
    expect(isPublicRoute("GET", "/api/journals/public//abc")).toBe(false);
    expect(isPublicRoute("GET", "/api/shop/items")).toBe(false);
    expect(isPublicRoute("GET", "/auth")).toBe(false);
    expect(isPublicRoute("GET", "/api/forms")).toBe(false);
    expect(isPublicRoute("GET", "/hackatime/connect")).toBe(false);
    expect(isPublicRoute("GET", "/api/admin/online")).toBe(false);
  });
});

describe("requireSession (deny by default)", () => {
  test("a Bearer token is the only way in", async () => {
    const t = tokenFor("u-ok");
    const res = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${t}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe("u-ok");
  });

  test("a token in the query string is refused, even with a valid Bearer header", async () => {
    const t = tokenFor("u-query");
    expect((await fetch(`${base}/api/me?token=${t}`)).status).toBe(400);
    expect((await fetch(`${base}/api/me?token=${t}`, { headers: { Authorization: `Bearer ${t}` } })).status).toBe(400);
    expect((await fetch(`${base}/api/news?token=${t}`)).status).toBe(400);
  });

  test("missing, malformed and forged tokens are 401 with an audit row", async () => {
    audits.length = 0;
    resetAuditThrottle();
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: "Basic abc" } })).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: "Bearer not.a.jwt" } })).status).toBe(401);
    await flush();
    expect(audits.filter((a) => a.action === "auth.session_rejected").length).toBeGreaterThanOrEqual(3);
  });

  test("an unknown route is still behind auth", async () => {
    expect((await fetch(`${base}/api/does-not-exist`)).status).toBe(401);
  });

  test("revoked and banned sessions are refused", async () => {
    revoked.add("u-revoked");
    banned.add("u-banned");
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${tokenFor("u-revoked")}` } })).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${tokenFor("u-banned")}` } })).status).toBe(403);
  });

  test("bearerToken parsing", () => {
    expect(bearerToken({ headers: { authorization: "Bearer abc.def.ghi" } })).toBe("abc.def.ghi");
    expect(bearerToken({ headers: { authorization: "bearer abc" } })).toBe("abc");
    expect(bearerToken({ headers: { authorization: "Bearer" } })).toBeNull();
    expect(bearerToken({ headers: { authorization: "Bearer a b" } })).toBeNull();
    expect(bearerToken({ headers: {} })).toBeNull();
  });
});

describe("service keys", () => {
  test("each key maps to its own service; short or unset keys never match", () => {
    expect(matchServiceKey(DASH_KEY, keys)).toBe("pixl-dashboard");
    expect(matchServiceKey(INTERNAL_KEY, keys)).toBe("internal-dashboard");
    expect(matchServiceKey(PIXO_KEY, keys)).toBe("pixo");
    expect(matchServiceKey("nope", keys)).toBeNull();
    expect(matchServiceKey("", keys)).toBeNull();
    const short = "s".repeat(MIN_SERVICE_KEY_LENGTH - 1);
    expect(matchServiceKey(short, { SERVICE_KEY_PIXO: short })).toBeNull();
  });

  test("/api/admin answers only to the internal dashboard's key", async () => {
    audits.length = 0;
    resetAuditThrottle();
    const call = (headers: Record<string, string>) => fetch(`${base}/api/admin/online`, { headers });
    const ok = await call({ "x-pixl-service-key": INTERNAL_KEY });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { service: string }).service).toBe("internal-dashboard");
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-pixl-service-key": "wrong" })).status).toBe(401);
    // A player session is not an admin credential.
    expect((await call({ Authorization: `Bearer ${tokenFor("u-admin?")}` })).status).toBe(401);
    // Real keys for other callers are not allowed here.
    expect((await call({ "x-pixl-service-key": DASH_KEY })).status).toBe(403);
    expect((await call({ "x-pixl-service-key": PIXO_KEY })).status).toBe(403);
    // Express routes case-insensitively; so does the gate.
    expect((await fetch(`${base}/API/ADMIN/online`)).status).toBe(401);
    // The old ADMIN_API_KEY header and ?key= are gone.
    expect((await call({ "x-admin-key": INTERNAL_KEY })).status).toBe(401);
    expect((await fetch(`${base}/api/admin/online?key=${INTERNAL_KEY}`)).status).toBe(401);
    await flush();
    expect(audits.some((a) => a.action === "auth.service_key_rejected")).toBe(true);
    expect(audits.some((a) => a.action === "http.get" && a.actor_type === "service" && a.target === "/api/admin/online")).toBe(true);
  });
});

describe("validate()", () => {
  const auth = () => ({ Authorization: `Bearer ${tokenFor("u-validate")}`, "Content-Type": "application/json" });

  test("a valid request reaches the handler with unknown keys stripped", async () => {
    const res = await fetch(`${base}/api/things/7`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ name: "ok", isAdmin: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, body: { name: "ok" }, id: "7" });
  });

  test("bad body, params or query is a 400 that never echoes values", async () => {
    const tooLong = await fetch(`${base}/api/things/7`, { method: "POST", headers: auth(), body: JSON.stringify({ name: "secret-value" }) });
    expect(tooLong.status).toBe(400);
    const text = await tooLong.text();
    expect(text).toContain("invalid_request");
    expect(text).not.toContain("secret-value");
    expect((await fetch(`${base}/api/things/abc`, { method: "POST", headers: auth(), body: JSON.stringify({ name: "ok" }) })).status).toBe(400);
    expect((await fetch(`${base}/api/things/7`, { method: "POST", headers: auth(), body: JSON.stringify({ name: 5 }) })).status).toBe(400);
  });

  test("JSON bodies over 256kb are refused", async () => {
    const res = await fetch(`${base}/api/things/7`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ name: "x".repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  test("every non-GET /api request is audited with the route pattern, not the URL", async () => {
    audits.length = 0;
    resetAuditThrottle();
    await fetch(`${base}/api/things/42`, { method: "POST", headers: auth(), body: JSON.stringify({ name: "ok" }) });
    await flush();
    const row = audits.find((a) => a.action === "http.post");
    expect(row?.target).toBe("/api/things/:id");
    expect(row?.actor_id).toBe("u-validate");
    expect(row?.result).toBe("ok");
    expect(JSON.stringify(row?.meta)).not.toContain("Bearer");
  });
});

describe("game and web session kinds", () => {
  test("the HTTP API takes both kinds and exposes which one called", async () => {
    for (const client of ["game", "web"] as const) {
      const token = issueSessionToken({ client, userId: `u-${client}`, displayName: "T" });
      const res = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, userId: `u-${client}`, client });
    }
  });

  test("a pre-split token with no client claim is refused", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const legacy = jwt.sign({ userId: "u-legacy", displayName: "T" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
    const res = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${legacy}` } });
    expect(res.status).toBe(401);
  });
});
