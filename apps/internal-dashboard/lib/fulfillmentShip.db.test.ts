import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { releaseOrderClaim, settleGrant, settleItemFulfillment, settleShipment, unfulfillOrder } from "./fulfillmentShip";

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
        item_name text not null, status text not null, claimed_by text,
        claimed_by_slack text, claimed_at timestamptz,
        shipped_at timestamptz, fulfilled_at timestamptz, fulfilled_by text,
        tracking text, fulfillment_pixels_paid integer not null default 0,
        item_id bigint, is_grant boolean not null default false,
        item_flow boolean not null default false,
        ordered_at timestamptz, credited_at timestamptz, done_at timestamptz,
        hcb_link text, actual_cost_usd numeric
      );
      create table shop_order_unfulfillments (
        id bigserial primary key,
        order_id bigint not null references shop_orders(id) on delete cascade,
        fulfillment_kind text not null default 'item',
        fulfilled_at timestamptz, fulfilled_by text not null default '',
        fulfilled_by_slack text not null default '',
        hcb_link text not null default '', tracking text not null default '',
        actual_cost_usd numeric(10,2), pixels_paid integer not null default 0,
        unfulfilled_at timestamptz not null default now(),
        unfulfilled_by text not null default '',
        unfulfilled_by_slack text not null default '',
        reason text not null default ''
      );
      create table fulfillment_commitments (
        order_id bigint primary key references shop_orders(id),
        user_id uuid not null references users(id),
        amount_cents integer not null,
        basis text not null,
        verified_funding_cents integer not null,
        verdict text not null,
        policy_version text not null,
        authorized_by text not null,
        authorized_by_slack text not null,
        evidence jsonb not null default '{}'::jsonb,
        authorized_at timestamptz not null default now(),
        amount_updated_at timestamptz
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

  test("tracking is optional when closing a shipment", async () => {
    await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
      values (6, ${buyer}, 'Envelope', 'credited', 'UFULFILLER')`;
    expect(await settleShipment(6, "", "UFULFILLER", "Staff", 2, db)).not.toBeNull();
    const rows = await db`select status, tracking, fulfillment_pixels_paid from shop_orders where id = 6`;
    expect(rows[0]!.status).toBe("shipped");
    expect(rows[0]!.tracking).toBe("");
    expect(Number(rows[0]!.fulfillment_pixels_paid)).toBe(2);
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

  describe("claim release", () => {
    const commitment = (id: number, slack: string) =>
      db`insert into fulfillment_commitments (
        order_id, user_id, amount_cents, basis, verified_funding_cents,
        verdict, policy_version, authorized_by, authorized_by_slack
      ) values (${id}, ${buyer}, 1000, 'face', 5000, 'covered', 'test', 'Staff', ${slack})`;

    test("the claimer releases the order and its funding commitment", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by, claimed_by_slack, claimed_at, ordered_at)
        values (30, ${buyer}, 'Hosting Grant', 'claimed', 'Staff', 'UFULFILLER', now(), now())`;
      await commitment(30, "UFULFILLER");

      expect(await releaseOrderClaim(30, "UFULFILLER", false, db)).toBe(true);
      const [row] = await db`select status, claimed_by, claimed_by_slack, claimed_at, ordered_at
        from shop_orders where id = 30`;
      expect(row!.status).toBe("pending");
      expect(row!.claimed_by).toBe("");
      expect(row!.claimed_by_slack).toBe("");
      expect(row!.claimed_at).toBeNull();
      expect(row!.ordered_at).toBeNull();
      expect(await db`select order_id from fulfillment_commitments where order_id = 30`).toHaveLength(0);
    });

    test("another fulfiller cannot release it", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by, claimed_by_slack, claimed_at)
        values (31, ${buyer}, 'Hosting Grant', 'claimed', 'Staff', 'UFULFILLER', now())`;
      await commitment(31, "UFULFILLER");

      expect(await releaseOrderClaim(31, "UOTHER", false, db)).toBe(false);
      const [row] = await db`select status, claimed_by_slack from shop_orders where id = 31`;
      expect(row!.status).toBe("claimed");
      expect(row!.claimed_by_slack).toBe("UFULFILLER");
      expect(await db`select order_id from fulfillment_commitments where order_id = 31`).toHaveLength(1);
    });

    test("an owner can release someone else's claim", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by, claimed_by_slack, claimed_at)
        values (32, ${buyer}, 'Hosting Grant', 'claimed', 'Other', 'UOTHER', now())`;
      await commitment(32, "UOTHER");

      expect(await releaseOrderClaim(32, "UFULFILLER", true, db)).toBe(true);
      const [row] = await db`select status from shop_orders where id = 32`;
      expect(row!.status).toBe("pending");
      expect(await db`select order_id from fulfillment_commitments where order_id = 32`).toHaveLength(0);
    });

    test("a done order is untouched", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
        values (33, ${buyer}, 'Hosting Grant', 'done', 'UFULFILLER')`;
      expect(await releaseOrderClaim(33, "UFULFILLER", true, db)).toBe(false);
      const [row] = await db`select status from shop_orders where id = 33`;
      expect(row!.status).toBe("done");
    });
  });

  describe("single-step item fulfillment", () => {
    test("claimed goes straight to done with link and cost; tracking is optional", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
        values (20, ${buyer}, 'Keyboard', 'claimed', 'UFULFILLER')`;
      const before = await db`select pixels from users where id = ${fulfiller}`;
      const result = await settleItemFulfillment(
        20,
        { tracking: "", hcbLink: "https://hcb.example/tx/1", actualCostUsd: 45 },
        "UFULFILLER",
        "Staff",
        6,
        db,
      );
      expect(result).not.toBeNull();
      const [row] = await db`select status, hcb_link, actual_cost_usd, tracking, fulfillment_pixels_paid,
        ordered_at, credited_at, shipped_at, done_at from shop_orders where id = 20`;
      expect(row!.status).toBe("done");
      expect(Number(row!.actual_cost_usd)).toBe(45);
      expect(row!.tracking).toBe("");
      expect(Number(row!.fulfillment_pixels_paid)).toBe(6);
      expect(row!.ordered_at).not.toBeNull();
      expect(row!.credited_at).not.toBeNull();
      expect(row!.done_at).not.toBeNull();
      const after = await db`select pixels from users where id = ${fulfiller}`;
      expect(Number(after[0]!.pixels) - Number(before[0]!.pixels)).toBe(6);
    });

    test("two simultaneous fulfillments transition and pay exactly once", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
        values (21, ${buyer}, 'Sticker', 'claimed', 'UFULFILLER')`;
      const attempts = await Promise.all([
        settleItemFulfillment(21, { tracking: "T-1", hcbLink: "https://hcb.example/tx/2", actualCostUsd: 3 }, "UFULFILLER", "Staff", 6, db),
        settleItemFulfillment(21, { tracking: "T-2", hcbLink: "https://hcb.example/tx/3", actualCostUsd: 4 }, "UFULFILLER", "Staff", 6, db),
      ]);
      expect(attempts.filter(Boolean)).toHaveLength(1);
      const [row] = await db`select status, tracking, fulfillment_pixels_paid from shop_orders where id = 21`;
      expect(row!.status).toBe("done");
      expect(["T-1", "T-2"]).toContain(row!.tracking);
    });

    test("a legacy credited order can finish, but shipped already did", async () => {
      await db`insert into shop_orders (id, user_id, item_name, status, claimed_by_slack)
        values (22, ${buyer}, 'Legacy', 'credited', 'UFULFILLER'),
               (23, ${buyer}, 'Already shipped', 'shipped', 'UFULFILLER')`;
      expect(await settleItemFulfillment(22, { tracking: "", hcbLink: "https://hcb.example/tx/4", actualCostUsd: 9 }, "UFULFILLER", "Staff", 6, db)).not.toBeNull();
      expect(await settleItemFulfillment(23, { tracking: "", hcbLink: "https://hcb.example/tx/5", actualCostUsd: 9 }, "UFULFILLER", "Staff", 6, db)).toBeNull();
    });
  });

  describe("unfulfill and re-fulfill", () => {
    test("a done grant is reopened, its previous fulfillment kept, and its payout not clawed back", async () => {
      await db`insert into shop_items (id, category) values (102, 'grants') on conflict (id) do nothing`;
      await db`insert into shop_orders (
        id, user_id, item_name, status, claimed_by, claimed_by_slack, claimed_at,
        ordered_at, credited_at, shipped_at, done_at, fulfilled_at, fulfilled_by,
        tracking, hcb_link, actual_cost_usd, fulfillment_pixels_paid, item_id, is_grant
      ) values (
        40, ${buyer}, 'Hosting Grant', 'done', 'Staff', 'UFULFILLER', now(),
        now(), now(), now(), now(), now(), 'Staff',
        'https://hcb.example/grants/X', 'https://hcb.example/grants/X', 10, 2, 102, true
      )`;
      const before = await db`select pixels from users where id = ${fulfiller}`;

      const result = await unfulfillOrder(40, "Grant refunded by HCB", "Owner", "UOWNER", { flow: "item" }, db);
      expect(result).toMatchObject({ status: "claimed", claimerSlack: "UFULFILLER", pixelsPaid: 2 });

      const [row] = await db`select status, claimed_by_slack, hcb_link, tracking, actual_cost_usd,
        done_at, shipped_at, fulfilled_at, fulfillment_pixels_paid, is_grant, item_flow
        from shop_orders where id = 40`;
      expect(row!.status).toBe("claimed");
      expect(row!.claimed_by_slack).toBe("UFULFILLER");
      expect(row!.hcb_link).toBe("");
      expect(row!.tracking).toBe("");
      expect(row!.actual_cost_usd).toBeNull();
      expect(row!.done_at).toBeNull();
      expect(row!.shipped_at).toBeNull();
      expect(row!.fulfilled_at).toBeNull();
      expect(Number(row!.fulfillment_pixels_paid)).toBe(2);
      expect(row!.is_grant).toBe(false);
      expect(row!.item_flow).toBe(true);

      const [history] = await db`select * from shop_order_unfulfillments where order_id = 40`;
      expect(history!.fulfillment_kind).toBe("grant");
      expect(history!.fulfilled_by).toBe("Staff");
      expect(history!.fulfilled_by_slack).toBe("UFULFILLER");
      expect(history!.hcb_link).toBe("https://hcb.example/grants/X");
      expect(Number(history!.actual_cost_usd)).toBe(10);
      expect(Number(history!.pixels_paid)).toBe(2);
      expect(history!.reason).toBe("Grant refunded by HCB");
      expect(history!.unfulfilled_by).toBe("Owner");

      const after = await db`select pixels from users where id = ${fulfiller}`;
      expect(Number(after[0]!.pixels)).toBe(Number(before[0]!.pixels));
    });

    test("re-fulfilling adds the new payout, and the next unfulfill records only that attempt", async () => {
      const settled = await settleItemFulfillment(
        40,
        { tracking: "1Z-REBUY", hcbLink: "https://hcb.example/tx/40", actualCostUsd: 9 },
        "UFULFILLER",
        "Staff",
        6,
        db,
      );
      expect(settled).not.toBeNull();

      let [row] = await db`select status, tracking, fulfillment_pixels_paid from shop_orders where id = 40`;
      expect(row!.status).toBe("done");
      expect(row!.tracking).toBe("1Z-REBUY");
      expect(Number(row!.fulfillment_pixels_paid)).toBe(8);

      expect(await unfulfillOrder(40, "Second issue", "Owner", "UOWNER", {}, db)).not.toBeNull();
      [row] = await db`select status, fulfillment_pixels_paid from shop_orders where id = 40`;
      expect(row!.status).toBe("claimed");
      expect(Number(row!.fulfillment_pixels_paid)).toBe(8);

      const history = await db`select pixels_paid from shop_order_unfulfillments
        where order_id = 40 order by id`;
      expect(history.map((h) => Number(h.pixels_paid))).toEqual([2, 6]);
    });

    test("a second unfulfill of an order that is no longer finished is a no-op", async () => {
      expect(await unfulfillOrder(40, "again", "Owner", "UOWNER", {}, db)).toBeNull();
      const rows = await db`select id from shop_order_unfulfillments where order_id = 40`;
      expect(rows).toHaveLength(2);
    });

    test("an unclaimed legacy shipment returns to the New queue and drops its commitment", async () => {
      await db`insert into shop_orders (
        id, user_id, item_name, status, claimed_by_slack, claimed_at,
        shipped_at, fulfilled_at, fulfillment_pixels_paid
      ) values (41, ${buyer}, 'Legacy pin', 'shipped', '', now(), now(), now(), 2)`;
      await db`insert into fulfillment_commitments (
        order_id, user_id, amount_cents, basis, verified_funding_cents,
        verdict, policy_version, authorized_by, authorized_by_slack
      ) values (41, ${buyer}, 1000, 'budget', 5000, 'covered', 'test', 'Staff', 'UFULFILLER')`;

      const result = await unfulfillOrder(41, "returned to sender", "Owner", "UOWNER", {}, db);
      expect(result?.status).toBe("pending");
      const [row] = await db`select status, claimed_by_slack from shop_orders where id = 41`;
      expect(row!.status).toBe("pending");
      expect(row!.claimed_by_slack).toBe("");
      expect(await db`select order_id from fulfillment_commitments where order_id = 41`).toHaveLength(0);
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
