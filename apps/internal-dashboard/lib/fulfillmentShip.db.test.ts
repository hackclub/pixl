import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { settleGrant, settleShipment } from "./fulfillmentShip";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;
const suite = adminUrl ? describe : describe.skip;

suite("atomic fulfillment shipment", () => {
  const name = "pixl_ship_" + randomBytes(5).toString("hex");
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  const buyer = "11111111-1111-4111-8111-111111111111";
  const fulfiller = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const url = new URL(adminUrl!);
    url.pathname = "/" + name;
    db = postgres(url.toString(), { max: 5, onnotice: () => {} });
    await db.unsafe(`
      create table users (
        id uuid primary key, slack_id text unique, pixels bigint not null default 0
      );
      create table shop_orders (
        id bigint primary key, user_id uuid not null references users(id),
        item_name text not null, status text not null, claimed_by_slack text,
        shipped_at timestamptz, fulfilled_at timestamptz, fulfilled_by text,
        tracking text, fulfillment_pixels_paid integer not null default 0,
        item_id bigint, is_grant boolean not null default false,
        ordered_at timestamptz, credited_at timestamptz, done_at timestamptz,
        hcb_link text, actual_cost_usd numeric
      );
      create table shop_items (id bigint primary key, category text);
      create table pixel_transactions (
        id bigserial primary key, user_id uuid references users(id),
        project_id bigint, amount bigint, hours numeric, reason text, created_by text
      );
    `);
    await db`insert into users (id, slack_id) values
      (${buyer}, 'UBUYER000'), (${fulfiller}, 'UFULFILLER')`;
  });

  afterAll(async () => {
    await db?.end();
    await admin.unsafe("drop database " + name + " with (force)");
    await admin.end();
  });

  test("two simultaneous ship attempts transition and reward exactly once", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (1, ${buyer}, 'Sticker', 'credited', 'UFULFILLER')`;
    const attempts = await Promise.all([
      settleShipment(1, "TRACK-1", "UFULFILLER", "Staff", 2, db),
      settleShipment(1, "TRACK-2", "UFULFILLER", "Staff", 2, db),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter(x => x === null)).toHaveLength(1);
    const rows = await db`select status, fulfillment_pixels_paid, tracking from shop_orders where id = 1`;
    expect(rows[0]!.status).toBe("shipped");
    expect(Number(rows[0]!.fulfillment_pixels_paid)).toBe(2);
    expect(["TRACK-1", "TRACK-2"]).toContain(rows[0]!.tracking);
    expect(await db`select id from pixel_transactions where reason = 'fulfillment_payout'`).toHaveLength(1);
    const wallets = await db`select pixels from users where id = ${fulfiller}`;
    expect(Number(wallets[0]!.pixels)).toBe(2);
  });

  test("refuses an order claimed by another fulfiller without paying", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (2, ${buyer}, 'Pin', 'credited', 'UOTHER')`;
    expect(await settleShipment(2, "TRACK", "UFULFILLER", "Staff", 2, db)).toBeNull();
    const rows = await db`select status from shop_orders where id = 2`;
    expect(rows[0]!.status).toBe("credited");
    expect(await db`select id from pixel_transactions where reason = 'fulfillment_payout'`).toHaveLength(1);
  });

  test("refuses an attempt to ship one's own order", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (3, ${fulfiller}, 'Own reward', 'credited', 'UFULFILLER')`;
    expect(await settleShipment(3, "TRACK", "UFULFILLER", "Staff", 2, db)).toBeNull();
    const rows = await db`select status from shop_orders where id = 3`;
    expect(rows[0]!.status).toBe("credited");
  });

  test("an owner may ship their own order and is paid as usual", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (5, ${fulfiller}, 'Owner reward', 'credited', 'UFULFILLER')`;
    const before = await db`select pixels from users where id = ${fulfiller}`;
    const result = await settleShipment(5, "TRACK", "UFULFILLER", "Staff", 2, db, true);
    expect(result).not.toBeNull();
    const rows = await db`select status, fulfillment_pixels_paid from shop_orders where id = 5`;
    expect(rows[0]!.status).toBe("shipped");
    expect(Number(rows[0]!.fulfillment_pixels_paid)).toBe(2);
    const after = await db`select pixels from users where id = ${fulfiller}`;
    expect(Number(after[0]!.pixels) - Number(before[0]!.pixels)).toBe(2);
  });

  describe("grants", () => {
    test("two simultaneous sends close the grant and pay exactly once", async () => {
      await db`insert into shop_items (id, category) values (100, 'grants')`;
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack, item_id)
        values (10, ${buyer}, 'Hosting Grant', 'claimed', 'UFULFILLER', 100)`;
      const before = await db`select pixels from users where id = ${fulfiller}`;
      const attempts = await Promise.all([
        settleGrant(10, "https://hcb.example/grants/A", 10, "UFULFILLER", "Staff", 2, db),
        settleGrant(10, "https://hcb.example/grants/B", 10, "UFULFILLER", "Staff", 2, db),
      ]);
      expect(attempts.filter(Boolean)).toHaveLength(1);
      const [row] = await db`select status, tracking, hcb_link, actual_cost_usd, fulfillment_pixels_paid,
        ordered_at, credited_at, shipped_at, done_at from shop_orders where id = 10`;
      expect(row!.status).toBe("done");
      expect(Number(row!.actual_cost_usd)).toBe(10);
      expect(Number(row!.fulfillment_pixels_paid)).toBe(2);
      expect(row!.tracking).toBe(row!.hcb_link);
      expect(row!.ordered_at).not.toBeNull();
      expect(row!.credited_at).not.toBeNull();
      expect(row!.shipped_at).not.toBeNull();
      expect(row!.done_at).not.toBeNull();
      const after = await db`select pixels from users where id = ${fulfiller}`;
      expect(Number(after[0]!.pixels) - Number(before[0]!.pixels)).toBe(2);
    });

    test("an order converted with is_grant takes the grant flow too", async () => {
      await db`insert into shop_items (id, category) values (101, 'other')`;
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack, item_id, is_grant)
        values (11, ${buyer}, 'Custom request', 'claimed', 'UFULFILLER', 101, true)`;
      expect(await settleGrant(11, "https://hcb.example/grants/C", 25, "UFULFILLER", "Staff", 2, db)).not.toBeNull();
    });

    test("refuses a non-grant item order without paying", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack, item_id)
        values (12, ${buyer}, 'Pin', 'claimed', 'UFULFILLER', 101)`;
      const before = await db`select pixels from users where id = ${fulfiller}`;
      expect(await settleGrant(12, "https://hcb.example/grants/D", 5, "UFULFILLER", "Staff", 2, db)).toBeNull();
      const [row] = await db`select status from shop_orders where id = 12`;
      expect(row!.status).toBe("claimed");
      const after = await db`select pixels from users where id = ${fulfiller}`;
      expect(Number(after[0]!.pixels)).toBe(Number(before[0]!.pixels));
    });

    test("refuses a grant that is not claimed by this fulfiller", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack, item_id)
        values (13, ${buyer}, 'Hosting Grant', 'claimed', 'UOTHER', 100),
               (14, ${buyer}, 'Hosting Grant', 'pending', '', 100)`;
      expect(await settleGrant(13, "https://hcb.example/grants/E", 10, "UFULFILLER", "Staff", 2, db)).toBeNull();
      expect(await settleGrant(14, "https://hcb.example/grants/F", 10, "UFULFILLER", "Staff", 2, db)).toBeNull();
    });

    test("refuses sending your own grant, unless the sender is an owner", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack, item_id)
        values (15, ${fulfiller}, 'Hosting Grant', 'claimed', 'UFULFILLER', 100)`;
      expect(await settleGrant(15, "https://hcb.example/grants/G", 10, "UFULFILLER", "Staff", 2, db)).toBeNull();
      expect(await settleGrant(15, "https://hcb.example/grants/G", 10, "UFULFILLER", "Staff", 2, db, true)).not.toBeNull();
    });
  });

  test("a missing fulfiller account cannot consume the shipment transition", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (4, ${buyer}, 'Kit', 'credited', 'UMISSING')`;
    await expect(settleShipment(4, "TRACK", "UMISSING", "Staff", 2, db)).rejects.toThrow("player account");
    const rows = await db`select status from shop_orders where id = 4`;
    expect(rows[0]!.status).toBe("credited");
  });
});
