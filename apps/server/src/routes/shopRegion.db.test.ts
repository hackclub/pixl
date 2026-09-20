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
  test("shop region purchase tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/shopRegion.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_shop_region_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  let server: Server;
  let base = "";
  let db: postgres.Sql;
  let sqlProxy: { end: () => Promise<void> };
  let issueToken: (userId: string) => string;
  let encrypt: (s: string) => string;

  const itemIds: Record<string, number> = {};

  async function createUser(opts: { country: string; region?: string; regionAuto?: boolean; pixels?: number }) {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name, pixels, region, region_auto,
        address_line1, address_city, address_country, address_postal)
      values ('test', ${randomBytes(6).toString("hex")}, 'tester', ${opts.pixels ?? 100000},
        ${opts.region ?? "US"}, ${opts.regionAuto ?? true},
        '1 Test St', 'Testville', ${encrypt(opts.country)}, '12345')
      returning id`;
    return row.id;
  }

  async function createItem(name: string, region: string, unlockXp = 0) {
    const [row] = await db<{ id: number }[]>`
      insert into shop_items (name, price, region, unlock_xp, active)
      values (${name}, 100, ${region}, ${unlockXp}, true)
      returning id`;
    return row.id;
  }

  async function buy(userId: string, itemId: number) {
    const res = await fetch(`${base}/api/shop/buy/${itemId}?token=${issueToken(userId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ option: "" }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function orderCount(userId: string) {
    const [row] = await db<{ n: number }[]>`select count(*)::int as n from shop_orders where user_id = ${userId}`;
    return row.n;
  }

  async function pixels(userId: string) {
    const [row] = await db<{ pixels: string }[]>`select pixels from users where id = ${userId}`;
    return Number(row.pixels);
  }

  async function callRpc(userId: string, itemId: number, buyerRegion: string | null) {
    const [row] = await db<{ r: { ok: boolean; error?: string } }[]>`
      select buy_shop_item(p_user_id => ${userId}::uuid, p_item_id => ${itemId}::int, p_option => '',
        p_buyer_region => ${buyerRegion}::text) as r`;
    return row.r;
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }

    process.env.DATABASE_URL = testUrl.toString();
    process.env.JWT_SECRET = randomBytes(16).toString("hex");
    process.env.PII_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    const { default: shopRouter } = await import("./shop.js");
    const { issueSessionToken } = await import("../auth/session.js");
    const { encryptPII } = await import("../crypto.js");
    const { sql } = await import("../db/pgCompat.js");
    const [{ name }] = await sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);
    sqlProxy = sql;
    issueToken = (userId) => issueSessionToken({ userId, displayName: "tester" });
    encrypt = encryptPII;

    itemIds.europe = await createItem("Eu Widget", "EUROPE");
    itemIds.bangladesh = await createItem("Bd Widget", "BANGLADESH");
    itemIds.us = await createItem("Us Widget", "US");
    itemIds.trophy = await createItem("Trophy", "US", 500);

    const app = express();
    app.use(express.json());
    app.use(shopRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await sqlProxy?.end();
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("buy route + buy_shop_item authorize against the address country", () => {
    test("US address with a self-selected BANGLADESH region cannot buy a Bangladesh item", async () => {
      const user = await createUser({ country: "US", region: "BANGLADESH", regionAuto: false });
      const res = await buy(user, itemIds.bangladesh);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("wrong_region");
      expect(await orderCount(user)).toBe(0);
      expect(await pixels(user)).toBe(100000);
    });

    test("DE address with a stale default users.region of US can buy a EUROPE item", async () => {
      const user = await createUser({ country: "DE", region: "US", regionAuto: true });
      const res = await buy(user, itemIds.europe);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(await orderCount(user)).toBe(1);
      expect(await pixels(user)).toBe(100000 - 100);
    });

    test("DE address cannot buy the US item even when the account region says US", async () => {
      const user = await createUser({ country: "DE", region: "US", regionAuto: true });
      const res = await buy(user, itemIds.us);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("wrong_region");
      expect(await orderCount(user)).toBe(0);
    });

    test("a Bangladesh address can buy the Bangladesh item, and its browse region does not matter", async () => {
      const user = await createUser({ country: "BD", region: "EUROPE", regionAuto: false });
      const res = await buy(user, itemIds.bangladesh);
      expect(res.status).toBe(200);
      expect(await orderCount(user)).toBe(1);
    });

    test("a correct-region item succeeds for a US address", async () => {
      const user = await createUser({ country: "US" });
      const res = await buy(user, itemIds.us);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test("trying every item id against a US address only ever buys the US item", async () => {
      const user = await createUser({ country: "US", region: "BANGLADESH", regionAuto: false });
      const results: Record<string, number> = {};
      for (const [name, id] of Object.entries(itemIds)) results[name] = (await buy(user, id)).status;
      expect(results.europe).toBe(403);
      expect(results.bangladesh).toBe(403);
      expect(results.us).toBe(200);
      expect(await orderCount(user)).toBe(1);
    });

    test("trophy items are still not for sale, not region-blocked", async () => {
      const user = await createUser({ country: "DE" });
      const res = await buy(user, itemIds.trophy);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("not_for_sale");
    });

    test("an account without a readable address country cannot buy", async () => {
      const user = await createUser({ country: "" });
      await db`update users set address_country = 'gcm1:not-real' where id = ${user}`;
      const res = await buy(user, itemIds.us);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("address_required");
    });
  });

  describe("buy_shop_item itself", () => {
    test("uses p_buyer_region, not users.region", async () => {
      const user = await createUser({ country: "US", region: "BANGLADESH", regionAuto: false });
      expect((await callRpc(user, itemIds.bangladesh, "US")).error).toBe("wrong_region");
      expect((await callRpc(user, itemIds.us, "BANGLADESH")).error).toBe("wrong_region");
      expect(await orderCount(user)).toBe(0);
    });

    test("fails closed when no buyer region is supplied", async () => {
      const user = await createUser({ country: "US" });
      expect((await callRpc(user, itemIds.us, null)).error).toBe("wrong_region");
      expect(await orderCount(user)).toBe(0);
    });

    test("succeeds when the supplied region matches the item", async () => {
      const user = await createUser({ country: "DE", region: "US" });
      const result = await callRpc(user, itemIds.europe, "EUROPE");
      expect(result.ok).toBe(true);
      expect(await orderCount(user)).toBe(1);
    });

    test("only the region-checked overload exists and it is not executable by PUBLIC", async () => {
      const rows = await db<{ args: string; acl: string | null }[]>`
        select pg_get_function_arguments(p.oid) as args, p.proacl::text as acl from pg_proc p where p.proname = 'buy_shop_item'`;
      expect(rows).toHaveLength(1);
      expect(rows[0].args).toContain("p_buyer_region");
      expect(rows[0].acl ?? "").not.toMatch(/(^|,)=X/);
    });
  });
}
