import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { transferPixels } from "./pixelTransfer";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;
const suite = adminUrl ? describe : describe.skip;

suite("player-to-player pixel transfers", () => {
  const name = "pixl_transfer_" + randomBytes(5).toString("hex");
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  const carol = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const url = new URL(adminUrl!);
    url.pathname = "/" + name;
    db = postgres(url.toString(), { max: 5, onnotice: () => {} });
    await db.unsafe(`
      create table users (
        id uuid primary key, pixels bigint not null default 0
      );
      create table pixel_transactions (
        id bigserial primary key, user_id uuid not null references users(id),
        project_id bigint, amount bigint not null, hours numeric,
        reason text not null, created_by text not null
      );
    `);
    await db`insert into users (id) values (${alice}), (${bob}), (${carol})`;
  });

  afterAll(async () => {
    await db?.end();
    await admin.unsafe("drop database " + name + " with (force)");
    await admin.end();
  });

  test("moves pixels atomically and writes both sides of the ledger", async () => {
    await db`update users set pixels = 100 where id = ${alice}`;
    await db`update users set pixels = 0 where id = ${bob}`;
    await db`delete from pixel_transactions`;

    const result = await transferPixels(
      { fromUserId: alice, toUserId: bob, amount: 25, actor: "staff", note: "wrong account" },
      db,
    );

    expect(result).toEqual({ ok: true, fromBalance: 75, toBalance: 25 });
    const wallets = await db`select id, pixels from users order by id`;
    expect(wallets.map((w) => [String(w.id), Number(w.pixels)])).toEqual([
      [alice, 75],
      [bob, 25],
      [carol, 0],
    ]);
    const rows = await db`
      select user_id, amount, reason, created_by
      from pixel_transactions order by id`;
    expect(rows.map((r) => [String(r.user_id), Number(r.amount), r.reason, r.created_by])).toEqual([
      [alice, -25, "transfer_out", "staff , wrong account"],
      [bob, 25, "transfer_in", "staff , wrong account"],
    ]);
  });

  test("refuses to overdraw the sender and changes nothing", async () => {
    await db`update users set pixels = 5 where id = ${alice}`;
    await db`update users set pixels = 0 where id = ${bob}`;
    await db`delete from pixel_transactions`;

    const result = await transferPixels(
      { fromUserId: alice, toUserId: bob, amount: 10, actor: "staff", note: "test" },
      db,
    );

    expect(result).toMatchObject({ ok: false, balance: 5 });
    const wallets = await db`select pixels from users order by id`;
    expect(wallets.map((w) => Number(w.pixels))).toEqual([5, 0, 0]);
    expect(await db`select id from pixel_transactions`).toHaveLength(0);
  });

  test("rejects the same player, a missing player and a bad amount", async () => {
    expect(
      await transferPixels(
        { fromUserId: alice, toUserId: alice, amount: 1, actor: "staff", note: "test" },
        db,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await transferPixels(
        { fromUserId: alice, toUserId: carol, amount: 0, actor: "staff", note: "test" },
        db,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await transferPixels(
        { fromUserId: alice, toUserId: "44444444-4444-4444-8444-444444444444", amount: 1, actor: "staff", note: "test" },
        db,
      ),
    ).toMatchObject({ ok: false });
  });
});
