import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("ban enforcement tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/moderation.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_bans_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const goodUrl = new URL(adminUrl);
  goodUrl.pathname = `/${dbName}`;
  const badUrl = "postgres://postgres:test@127.0.0.1:1/none";

  let db: postgres.Sql;
  let server: Server;
  let base = "";
  let issueToken: (userId: string) => string;
  let connect: (url: string | null) => Promise<void>;
  const setEnv: string[] = [];

  async function createUser() {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name) values ('test', ${randomBytes(6).toString("hex")}, 't') returning id`;
    return row.id;
  }

  async function buy(userId: string) {
    const res = await fetch(`${base}/api/thing?token=${issueToken(userId)}`, { method: "POST" });
    return res.status;
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(goodUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }
    if (process.env.JWT_SECRET === undefined) {
      process.env.JWT_SECRET = randomBytes(16).toString("hex");
      setEnv.push("JWT_SECRET");
    }
    const { enforceActiveBans } = await import("./moderation.js");
    const { issueSessionToken } = await import("./auth/session.js");
    const pgCompat = await import("./db/pgCompat.js");
    connect = pgCompat.connectForTests;
    await connect(goodUrl.toString());
    const [{ name }] = await pgCompat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);
    issueToken = (userId) => issueSessionToken({ userId, displayName: "t" });

    const app = express();
    app.use(enforceActiveBans());
    app.post("/api/thing", (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await connect?.(null);
    for (const key of setEnv) delete process.env[key];
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("ban enforcement against a real bans table", () => {
    test("an account with no ban is not blocked", async () => {
      expect(await buy(await createUser())).toBe(200);
    });

    test("an account with an active ban is blocked", async () => {
      const user = await createUser();
      await db`insert into bans (user_id, reason, banned_by) values (${user}, 'test', 'test')`;
      expect(await buy(user)).toBe(403);
    });

    test("a lifted or expired ban does not block", async () => {
      const lifted = await createUser();
      await db`insert into bans (user_id, reason, banned_by, lifted_at) values (${lifted}, 'test', 'test', now())`;
      const expired = await createUser();
      await db`insert into bans (user_id, reason, banned_by, expires_at) values (${expired}, 'test', 'test', now() - interval '1 hour')`;
      expect(await buy(lifted)).toBe(200);
      expect(await buy(expired)).toBe(200);
    });

    test("a database outage refuses writes and never caches the failure as not banned", async () => {
      const banned = await createUser();
      await db`insert into bans (user_id, reason, banned_by) values (${banned}, 'test', 'test')`;
      await connect(badUrl);
      expect(await buy(banned)).toBe(503);
      expect(await buy(banned)).toBe(503);
      await connect(goodUrl.toString());
      expect(await buy(banned)).toBe(403);
    });
  });
}
