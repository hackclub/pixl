// Regressions for accurate unread counts and idempotent trophy claim alerts.
// Real PostgreSQL and actual Express routes, isolated from production.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;
if (!adminUrl) {
  test("inbox and trophy tests require a disposable Postgres", () => {
    throw new Error("PIXL_TEST_DATABASE_URL is required for notification and trophy DB tests");
  });
} else {
  const dbName = `pixl_inbox_claim_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  let db: postgres.Sql;
  let server: Server;
  let base: string;
  let currentUser = "";
  let trophyId: number;
  const addedEnv: string[] = [];

  async function user(): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name)
      values ('test', ${randomBytes(8).toString("hex")}, 'tester') returning id`;
    return row.id;
  }

  async function inbox(): Promise<{ status: number; body: { notifications: unknown[]; unread: number } }> {
    const res = await fetch(`${base}/api/notifications`);
    return { status: res.status, body: await res.json() };
  }

  async function alertCount(userId: string): Promise<number> {
    const [row] = await db<{ n: number }[]>`select count(*)::int as n from notifications
      where user_id = ${userId} and title = 'Trophy claimed! 🏆'`;
    return row.n;
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const migrator = postgres(url.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort())
      await migrator.unsafe(readFileSync(join(dir, f), "utf8"));
    await migrator.end();
    db = postgres(url.toString(), { max: 5, onnotice: () => {} });
    if (process.env.JWT_SECRET === undefined) {
      process.env.JWT_SECRET = randomBytes(16).toString("hex");
      addedEnv.push("JWT_SECRET");
    }
    const [{ default: notifications }, { default: shop }] = await Promise.all([
      import("./notifications.js"), import("./shop.js"),
    ]);
    const compat = await import("../db/pgCompat.js");
    await compat.connectForTests(url.toString());
    const [{ name }] = await compat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing tests against ${name}`);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { session: unknown }).session = {
        userId: currentUser, client: "web", displayName: "test",
      };
      next();
    });
    app.use(notifications);
    app.use(shop);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [trophy] = await db<{ id: number }[]>`
      insert into shop_items (name, price, unlock_xp, active)
      values ('test trophy', 0, 1, true) returning id`;
    trophyId = trophy.id;
  }, 120_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const { connectForTests } = await import("../db/pgCompat.js");
    await connectForTests(null);
    for (const k of addedEnv) delete process.env[k];
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("notifications and trophy claims", () => {
    test("unread count includes messages outside the newest 50 and excludes other users", async () => {
      currentUser = await user();
      const outsider = await user();
      for (let i = 0; i < 65; i++)
        await db`insert into notifications (user_id, title, body, read)
          values (${currentUser}, ${`notice-${i}`}, 'test', false)`;
      for (let i = 0; i < 7; i++)
        await db`insert into notifications (user_id, title, body, read)
          values (${currentUser}, 'already read', 'test', true)`;
      await db`insert into notifications (user_id, title, body, read)
        values (${outsider}, 'someone else', 'test', false)`;
      const first = await inbox();
      expect(first.status).toBe(200);
      expect(first.body.notifications).toHaveLength(50);
      expect(first.body.unread).toBe(65);
      await db`update notifications set read = true where user_id = ${currentUser}
        and title in ('notice-0', 'notice-1', 'notice-2')`;
      expect((await inbox()).body.unread).toBe(62);
    });

    test("a fresh trophy is notified once; retries and concurrent duplicate claims do not alert again", async () => {
      currentUser = await user();
      await db`insert into projects (user_id, name, status, approved_hours, level)
        values (${currentUser}, 'enough RE', 'approved', 1000, 1)`;
      const claim = async () => fetch(`${base}/api/shop/claim/${trophyId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const responses = await Promise.all([claim(), claim(), claim()]);
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      const [claimRow] = await db<{ n: number }[]>`select count(*)::int as n
        from shop_claims where user_id = ${currentUser} and item_id = ${trophyId}`;
      expect(claimRow.n).toBe(1);
      // addNotification is best-effort and fire-and-forget; allow that query to finish.
      let alerts = 0;
      for (let i = 0; i < 40; i++) {
        alerts = await alertCount(currentUser);
        if (alerts > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(alerts).toBe(1);
      expect((await claim()).status).toBe(200);
      expect(await alertCount(currentUser)).toBe(1);
    });
  });
}
