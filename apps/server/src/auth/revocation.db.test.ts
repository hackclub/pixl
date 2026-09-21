import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("session revocation tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/auth/revocation.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_revoke_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const goodUrl = new URL(adminUrl);
  goodUrl.pathname = `/${dbName}`;
  const badUrl = "postgres://postgres:test@127.0.0.1:1/none";
  const TTL = 10_000;

  let db: postgres.Sql;
  let connect: (url: string | null) => Promise<void>;
  let issueSessionToken: typeof import("./session.js").issueSessionToken;
  let rev: typeof import("./revocation.js");
  const setEnv: string[] = [];
  const servers: Server[] = [];

  function issueAt(userId: string, ms: number): string {
    setSystemTime(new Date(ms));
    try {
      return issueSessionToken({ userId, displayName: "t" });
    } finally {
      setSystemTime();
    }
  }

  async function createUser() {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name) values ('test', ${randomBytes(6).toString("hex")}, 't') returning id`;
    return row.id;
  }

  async function startReplica(clock: { now: number }) {
    const cache = rev.createRevocationCache(rev.lookupSessionRevokedAt, TTL, () => clock.now);
    const app = express();
    app.use(rev.enforceSessionRevocation({ revokedAt: cache.get }));
    app.get("/api/thing", (_req, res) => res.json({ ok: true }));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (token: string) => {
      const res = await fetch(`${base}/api/thing?token=${token}`);
      return { status: res.status, body: (await res.json()) as { error?: string } };
    };
    return { cache, call };
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(goodUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }
    if (process.env.JWT_SECRET === undefined) {
      process.env.JWT_SECRET = randomBytes(16).toString("hex");
      setEnv.push("JWT_SECRET");
    }
    ({ issueSessionToken } = await import("./session.js"));
    rev = await import("./revocation.js");
    const pgCompat = await import("../db/pgCompat.js");
    connect = pgCompat.connectForTests;
    await connect(goodUrl.toString());
    const [{ name }] = await pgCompat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);
  }, 120_000);

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    await connect?.(null);
    for (const key of setEnv) delete process.env[key];
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  afterEach(() => setSystemTime());

  describe("session revocation against a real users table", () => {
    test("revoking one user kills their old token on every replica and after a restart, others stay logged in", async () => {
      const victim = await createUser();
      const bystander = await createUser();
      const clock = { now: 0 };
      const replicaA = await startReplica(clock);
      const replicaB = await startReplica(clock);

      const leaked = issueAt(victim, Date.now() - 30_000);
      const bystanderToken = issueAt(bystander, Date.now() - 30_000);

      expect((await replicaA.call(leaked)).status).toBe(200);
      expect((await replicaB.call(leaked)).status).toBe(200);

      expect(await rev.revokeUserSessions(victim)).toBe("revoked");
      replicaA.cache.forget(victim);

      const onA = await replicaA.call(leaked);
      expect(onA.status).toBe(401);
      expect(onA.body.error).toBe("session_revoked");

      expect((await replicaB.call(leaked)).status).toBe(200);
      clock.now += TTL;
      expect((await replicaB.call(leaked)).status).toBe(401);

      const restarted = await startReplica({ now: 0 });
      expect((await restarted.call(leaked)).status).toBe(401);

      for (const replica of [replicaA, replicaB, restarted]) {
        expect((await replica.call(bystanderToken)).status).toBe(200);
      }
    });

    test("a token issued after the revocation is accepted everywhere", async () => {
      const user = await createUser();
      const leaked = issueAt(user, Date.now() - 30_000);
      expect(await rev.revokeUserSessions(user)).toBe("revoked");

      const fresh = issueAt(user, Date.now() + 3_000);
      const replica = await startReplica({ now: 0 });
      expect((await replica.call(leaked)).status).toBe(401);
      expect((await replica.call(fresh)).status).toBe(200);
    });

    test("repeated revocation never moves the cutoff backwards", async () => {
      const user = await createUser();
      const later = Date.now();
      await rev.revokeUserSessions(user, later);
      await rev.revokeUserSessions(user, later - 60_000);
      expect(await rev.lookupSessionRevokedAt(user)).toEqual({ ok: true, revokedAtMs: later });
    });

    test("an unknown user id reports not_found instead of silently succeeding", async () => {
      expect(await rev.revokeUserSessions(randomUUID())).toBe("not_found");
    });

    test("only a timestamp is stored, never the token", async () => {
      const user = await createUser();
      const token = issueAt(user, Date.now() - 30_000);
      const replica = await startReplica({ now: 0 });
      await replica.call(token);
      await rev.revokeUserSessions(user);
      const [{ row }] = await db<{ row: string }[]>`select to_jsonb(u)::text as row from users u where id = ${user}`;
      expect(row).not.toContain(token);
      expect(row).not.toContain(token.split(".")[1]);
      const [{ data_type }] = await db<{ data_type: string }[]>`
        select data_type from information_schema.columns where table_name = 'users' and column_name = 'sessions_revoked_at'`;
      expect(data_type).toBe("timestamp with time zone");
    });

    test("a database outage refuses the request and never caches it as not revoked", async () => {
      const victim = await createUser();
      const token = issueAt(victim, Date.now() - 30_000);
      await rev.revokeUserSessions(victim);
      const replica = await startReplica({ now: 0 });
      await connect(badUrl);
      expect((await replica.call(token)).status).toBe(503);
      expect((await replica.call(token)).status).toBe(503);
      await connect(goodUrl.toString());
      expect((await replica.call(token)).status).toBe(401);
    });

    test("a database that predates the migration keeps working and reports revocation as unavailable", async () => {
      const user = await createUser();
      const token = issueAt(user, Date.now() - 30_000);
      await db`alter table users drop column sessions_revoked_at`;
      try {
        const replica = await startReplica({ now: 0 });
        expect((await replica.call(token)).status).toBe(200);
        expect(await rev.revokeUserSessions(user)).toBe("not_migrated");
      } finally {
        await db`alter table users add column sessions_revoked_at timestamptz`;
      }
    });
  });

  describe("parseRevokedAt", () => {
    test("reads dates, ISO strings, and null", () => {
      const at = Date.parse("2030-01-02T03:04:05.678Z");
      expect(rev.parseRevokedAt(new Date(at))).toEqual({ ok: true, revokedAtMs: at });
      expect(rev.parseRevokedAt("2030-01-02T03:04:05.678Z")).toEqual({ ok: true, revokedAtMs: at });
      expect(rev.parseRevokedAt(null)).toEqual({ ok: true, revokedAtMs: null });
    });

    test("an unreadable value is a failure, never a pass", () => {
      expect(rev.parseRevokedAt("not a date")).toEqual({ ok: false });
    });
  });
}
