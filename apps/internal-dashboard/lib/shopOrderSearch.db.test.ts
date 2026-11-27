import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { searchShopOrders } from "./shopOrderSearch";

const url = process.env.PIXL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("fulfillment search across all orders", () => {
  const name = "pixl_order_search_" + randomBytes(5).toString("hex");
  const admin = postgres(url!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  const player = "11111111-1111-4111-8111-111111111111";
  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const u = new URL(url!); u.pathname = "/" + name;
    db = postgres(u.toString(), { max: 3, onnotice: () => {} });
    await db.unsafe(`
      create table users (id uuid primary key, display_name text, real_name text, slack_id text);
      create table projects (id bigint primary key, user_id uuid, name text, repo_url text);
      create table shop_orders (id bigint primary key, user_id uuid, item_name text,
        option text, status text, claimed_by_slack text, flagged_at timestamptz, created_at timestamptz);
      insert into users values ('11111111-1111-4111-8111-111111111111','Public','Private Name','UPLAYER');
      insert into projects values (1,'11111111-1111-4111-8111-111111111111','Mars Rover','https://github.com/test/rover');
      insert into shop_orders (id,user_id,item_name,option,status,claimed_by_slack,created_at)
        select g,'11111111-1111-4111-8111-111111111111',
          case when g=1 then 'Old Need' else 'Modern Item' end,
          '',case when g=1 then 'credited' else 'ordered' end,
          case when g=1 then 'USTAFF' else 'UOTHER' end,
          now() + g * interval '1 minute' from generate_series(1,250) g;
    `);
  });
  afterAll(async () => { await db?.end(); await admin.unsafe("drop database " + name + " with (force)"); await admin.end(); });
  test("search finds an old order omitted by newest 200", async () => {
    const rows = await searchShopOrders(undefined, "Old Need", 200, {}, db);
    expect(rows.map(r => Number(r.id))).toEqual([1]);
  });
  test("my queue filters by claim and multiple stages before the limit", async () => {
    const rows = await searchShopOrders(undefined, "Item", 200,
      { claimedBySlack: "UOTHER", stages: ["credited"] }, db);
    expect(rows).toHaveLength(0);
    const found = await searchShopOrders(undefined, "Need", 200,
      { claimedBySlack: "USTAFF", stages: ["credited"] }, db);
    expect(found).toHaveLength(1);
  });
  test("private player names are searchable only by their fulfiller or owner", async () => {
    expect(await searchShopOrders(undefined, "Private Name", 10,
      { viewerSlack: "URANDOM" }, db)).toHaveLength(0);
    expect(await searchShopOrders(undefined, "Private Name", 10,
      { viewerSlack: "USTAFF" }, db)).toHaveLength(1);
    expect(await searchShopOrders(undefined, "Private Name", 10,
      { viewerSlack: "URANDOM", allowPrivateNames: true }, db)).toHaveLength(10);
  });
});
