import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;
const suite = adminUrl ? describe : describe.skip;

suite("claim_shop_order_with_commitment", () => {
  const dbName = `pixl_elig_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let sql: ReturnType<typeof postgres>;
  let userId: string;

  const claim = (orderId: number, amount: number, funding: number, opts: { enforce?: boolean; verdict?: string; slack?: string } = {}) =>
    sql`select claim_shop_order_with_commitment(
      ${orderId}, 'Fulfiller', ${opts.slack ?? "UF1"}, ${amount}, 'budget', ${funding}, 0,
      ${opts.enforce ?? true}, ${opts.verdict ?? "covered"}, 'test', ${sql.json({ k: 1 })}
    ) as r`.then((rows) => rows[0]!.r as { ok: boolean; code: string });

  const newOrderFor = async (user: string, status = "pending") =>
    Number((await sql`insert into shop_orders (user_id, status, price) values (${user}, ${status}, 100) returning id`)[0]!.id);
  const newOrder = () => newOrderFor(userId);
  const newUser = async () => (await sql`insert into users (oauth_provider, oauth_id, display_name) values ('test', gen_random_uuid()::text, 'Test') returning id`)[0]!.id as string;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    const migrator = postgres(url.toString(), { max: 1, onnotice: () => {} });
    for (const r of ["anon", "authenticated", "service_role"]) {
      await admin.unsafe(`do $$ begin create role ${r}; exception when duplicate_object then null; end $$`);
    }
    await migrator.unsafe("create extension if not exists pgcrypto; create schema if not exists extensions;");
    const dir = join(import.meta.dir, "../../../server/drizzle");
    const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.startsWith("0229")).sort();
    for (const f of files) await migrator.unsafe(readFileSync(join(dir, f), "utf8"));
    await migrator.unsafe(readFileSync(join(dir, "0229_fulfillment_commitments.sql"), "utf8"));
    await migrator.end({ timeout: 2 });
    sql = postgres(url.toString(), { max: 8, onnotice: () => {} });
    userId = (await sql`insert into users (oauth_provider, oauth_id, display_name) values ('test', gen_random_uuid()::text, 'Test') returning id`)[0]!.id as string;
  });

  afterAll(async () => {
    await sql.end({ timeout: 2 });
    await admin.unsafe(`drop database ${dbName} with (force)`);
    await admin.end({ timeout: 2 });
  });

  test("concurrent claims of one player's orders cannot overspend funding", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, newOrder));
    const results = await Promise.all(ids.map((id) => claim(id, 1000, 3000)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "insufficient")).toBe(true);
    const [{ total }] = await sql`
      select coalesce(sum(c.amount_cents), 0)::int as total
      from fulfillment_commitments c where c.order_id = any(${ids})`;
    expect(total).toBe(3000);
  });

  test("the same claim twice is idempotent and writes one ledger row", async () => {
    const id = await newOrder();
    expect(await claim(id, 500, 99999)).toEqual({ ok: true, code: "claimed" });
    expect(await claim(id, 500, 99999)).toEqual({ ok: true, code: "already_claimed" });
    const rows = await sql`select 1 from fulfillment_commitments where order_id = ${id}`;
    expect(rows).toHaveLength(1);
  });

  test("two fulfillers racing for one order produce one winner", async () => {
    const id = await newOrder();
    const [a, b] = await Promise.all([claim(id, 100, 99999, { slack: "UA" }), claim(id, 100, 99999, { slack: "UB" })]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [row] = await sql`select claimed_by_slack from shop_orders where id = ${id}`;
    expect(["UA", "UB"]).toContain(row!.claimed_by_slack);
  });

  test("an unverified verdict is refused under enforcement and allowed in advisory mode", async () => {
    const a = await newOrder();
    const b = await newOrder();
    expect((await claim(a, 100, 0, { verdict: "unverified" })).code).toBe("not_covered");
    expect((await claim(b, 100, 0, { verdict: "unverified", enforce: false })).ok).toBe(true);
  });

  test("a cancelled order stops counting toward the cap", async () => {
    const user = await newUser();
    const [a, b] = [await newOrderFor(user), await newOrderFor(user)];
    expect((await claim(a, 1000, 1000)).ok).toBe(true);
    expect((await claim(b, 1000, 1000)).code).toBe("insufficient");
    await sql`update shop_orders set status = 'cancelled' where id = ${a}`;
    expect((await claim(b, 1000, 1000)).ok).toBe(true);
  });

  test("the ledger records who authorized it, under which policy and evidence", async () => {
    const id = await newOrder();
    await claim(id, 700, 99999);
    const [row] = await sql`select authorized_by, authorized_by_slack, policy_version, evidence, authorized_at from fulfillment_commitments where order_id = ${id}`;
    expect(row).toMatchObject({ authorized_by: "Fulfiller", authorized_by_slack: "UF1", policy_version: "test" });
    expect(row!.evidence).toEqual({ k: 1 });
    expect(row!.authorized_at).toBeInstanceOf(Date);
  });
  test("separate fulfillers claiming different orders of one player cannot both spend the same funds", async () => {
    const user = await newUser();
    const ids = await Promise.all(Array.from({ length: 8 }, () => newOrderFor(user)));
    const results = await Promise.all(ids.map((id, i) => claim(id, 1500, 4000, { slack: `UF${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const [{ total }] = await sql`select coalesce(sum(amount_cents), 0)::int as total from fulfillment_commitments where user_id = ${user}`;
    expect(total).toBe(3000);
    const claimed = await sql`select count(*)::int as n from shop_orders where user_id = ${user} and status = 'ordered'`;
    expect(claimed[0]!.n).toBe(2);
  });

  test("orders of different players never block each other", async () => {
    const [u1, u2] = [await newUser(), await newUser()];
    const [a, b] = [await newOrderFor(u1), await newOrderFor(u2)];
    const [ra, rb] = await Promise.all([claim(a, 1000, 1000), claim(b, 1000, 1000)]);
    expect([ra.ok, rb.ok]).toEqual([true, true]);
  });

  test("a failed claim leaves no ledger row and the order stays pending", async () => {
    const user = await newUser();
    const id = await newOrderFor(user);
    expect((await claim(id, 5000, 1000)).code).toBe("insufficient");
    expect(await sql`select 1 from fulfillment_commitments where order_id = ${id}`).toHaveLength(0);
    expect((await sql`select status from shop_orders where id = ${id}`)[0]!.status).toBe("pending");
  });

  test("an error inside the claim transaction rolls the ledger insert and status flip back together", async () => {
    const user = await newUser();
    const id = await newOrderFor(user);
    await sql.unsafe(`create or replace function _boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await sql.unsafe(`create trigger _boom_t before update on shop_orders for each row when (new.status = 'ordered') execute function _boom()`);
    try {
      await expect(claim(id, 100, 99999)).rejects.toThrow();
    } finally {
      await sql.unsafe(`drop trigger _boom_t on shop_orders`);
    }
    expect(await sql`select 1 from fulfillment_commitments where order_id = ${id}`).toHaveLength(0);
    expect((await sql`select status from shop_orders where id = ${id}`)[0]!.status).toBe("pending");
    expect((await claim(id, 100, 99999)).ok).toBe(true);
  });

  test("refunding through the real cancel function frees the funds and a second cancel is a no-op", async () => {
    const user = await newUser();
    await sql`update users set pixels = 1000 where id = ${user}`;
    const [a, b] = [await newOrderFor(user), await newOrderFor(user)];
    expect((await claim(a, 1000, 1000)).ok).toBe(true);
    expect((await claim(b, 1000, 1000)).code).toBe("insufficient");
    const refunded = await sql`select cancel_claimed_shop_order(${a}, 'Owner') as n`;
    expect(refunded[0]!.n).toBe(100);
    expect((await sql`select cancel_claimed_shop_order(${a}, 'Owner') as n`)[0]!.n).toBe(0);
    expect((await claim(b, 1000, 1000)).ok).toBe(true);
    const [{ total }] = await sql`
      select coalesce(sum(c.amount_cents), 0)::int as total from fulfillment_commitments c
      join shop_orders o on o.id = c.order_id where c.user_id = ${user} and o.status <> 'cancelled'`;
    expect(total).toBe(1000);
  });

  test("a player cancelling a still-pending order never creates a commitment", async () => {
    const user = await newUser();
    const id = await newOrderFor(user);
    await sql`update users set pixels = 0 where id = ${user}`;
    await sql`select cancel_shop_order(${id}, ${user})`.catch(() => null);
    await sql`update shop_orders set status = 'cancelled' where id = ${id} and status = 'pending'`;
    expect(await sql`select 1 from fulfillment_commitments where order_id = ${id}`).toHaveLength(0);
    expect((await claim(id, 100, 99999)).code).toBe("not_pending");
  });

  test("a claim on a missing order is refused", async () => {
    expect((await claim(987654321, 100, 99999)).code).toBe("not_found");
  });

  test("refresh updates the amount after the real cost is entered and counts toward the cap", async () => {
    const user = await newUser();
    const [a, b] = [await newOrderFor(user), await newOrderFor(user)];
    expect((await claim(a, 1000, 2000)).ok).toBe(true);
    expect((await sql`select refresh_fulfillment_commitment(${a}, 1800, 'actual_cost') as ok`)[0]!.ok).toBe(true);
    expect((await sql`select amount_cents, basis, amount_updated_at from fulfillment_commitments where order_id = ${a}`)[0]).toMatchObject({ amount_cents: 1800, basis: "actual_cost" });
    expect((await claim(b, 1000, 2000)).code).toBe("insufficient");
    expect((await sql`select refresh_fulfillment_commitment(${b}, 1, 'x') as ok`)[0]!.ok).toBe(false);
  });

  test("a partially fulfilled player keeps only the claimed orders counted", async () => {
    const user = await newUser();
    const ids = await Promise.all([newOrderFor(user), newOrderFor(user), newOrderFor(user)]);
    expect((await claim(ids[0]!, 1000, 2500)).ok).toBe(true);
    expect((await claim(ids[1]!, 1000, 2500)).ok).toBe(true);
    expect((await claim(ids[2]!, 1000, 2500)).code).toBe("insufficient");
    await sql`update shop_orders set status = 'shipped' where id = ${ids[0]!}`;
    expect((await claim(ids[2]!, 500, 2500)).ok).toBe(true);
  });
});
