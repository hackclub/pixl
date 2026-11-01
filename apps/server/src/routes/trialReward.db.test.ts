import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { settleTrialReward } from "./trialReward";

const url = process.env.PIXL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("atomic Trial rewards", () => {
  const name = "pixl_trial_" + randomBytes(5).toString("hex");
  const admin = postgres(url!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  const user = "11111111-1111-4111-8111-111111111111";
  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const target = new URL(url!); target.pathname = "/" + name;
    db = postgres(target.toString(), { max: 5, onnotice: () => {} });
    await db.unsafe(`
      create table users (id uuid primary key, pixels bigint not null default 0);
      create table shop_items (id bigint primary key, name text);
      create table sidequests (id bigint primary key, name text, reward text, prize_shop_item_id bigint);
      create table projects (
        id bigint primary key, user_id uuid, name text, status text,
        sidequest_id bigint, trial_reward_choice text, trial_held_px numeric,
        trial_prize_px numeric, approved_hours numeric, trial_prize_order_id bigint
      );
      create table shop_orders (id bigint generated always as identity primary key,
        user_id uuid, item_id bigint, item_name text, option text, price numeric, status text);
      create table pixel_transactions (project_id bigint, user_id uuid, amount numeric, reason text);
      insert into users(id) values ('11111111-1111-4111-8111-111111111111');
      insert into sidequests(id,name,reward) values (1,'Test Trial','Prize');
      insert into projects (id,user_id,name,status,sidequest_id,trial_reward_choice,trial_held_px,trial_prize_px,approved_hours)
        values (1,'11111111-1111-4111-8111-111111111111','Project','approved',1,'pending',30,20,3),
               (2,'11111111-1111-4111-8111-111111111111','Project','approved',1,'pending',30,20,3),
               (3,'11111111-1111-4111-8111-111111111111','Project','approved',1,'pending',30,20,3);
      create function credit_project_pixels(p_user_id uuid, p_project_id bigint, p_amount numeric,
        p_hours numeric, p_created_by text) returns numeric language plpgsql as $$
      begin
        if p_project_id = 3 then raise exception 'simulated payout failure'; end if;
        update users set pixels = pixels + p_amount where id = p_user_id;
        insert into pixel_transactions(project_id,user_id,amount,reason)
          values (p_project_id,p_user_id,p_amount,'project_approved');
        return p_amount;
      end; $$;
    `);
  });
  afterAll(async () => { await db?.end(); await admin.unsafe("drop database " + name + " with (force)"); await admin.end(); });
  test("concurrent claims produce only one order and one reward", async () => {
    const results = await Promise.all([
      settleTrialReward(1, user, "item", db),
      settleTrialReward(1, user, "item", db),
    ]);
    expect(results.filter(x => x.ok)).toHaveLength(1);
    expect(await db`select id from shop_orders where item_name='Prize'`).toHaveLength(1);
    const state = await db`select trial_reward_choice,trial_prize_order_id from projects where id=1`;
    expect(state[0]!.trial_reward_choice).toBe("item");
    expect(state[0]!.trial_prize_order_id).not.toBeNull();
    expect(await db`select project_id from pixel_transactions where project_id=1`).toHaveLength(1);
  });
  test("pixel-only reward is idempotent", async () => {
    expect((await settleTrialReward(2, user, "pixels", db)).ok).toBe(true);
    expect((await settleTrialReward(2, user, "pixels", db)).ok).toBe(false);
    expect(await db`select project_id from pixel_transactions where project_id=2`).toHaveLength(1);
  });
  test("payout failure rolls back the order and leaves the choice pending", async () => {
    await expect(settleTrialReward(3, user, "item", db)).rejects.toThrow("simulated payout failure");
    const state = await db`select trial_reward_choice,trial_prize_order_id from projects where id=3`;
    expect(state[0]).toMatchObject({ trial_reward_choice: "pending", trial_prize_order_id: null });
    expect(await db`select id from shop_orders where item_name='Prize'`).toHaveLength(1);
  });
});
