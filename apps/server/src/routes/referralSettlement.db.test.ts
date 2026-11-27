import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.PIXL_TEST_DATABASE_URL;
if (!url) {
  test("referral settlement requires a local test Postgres", () => { throw new Error("PIXL_TEST_DATABASE_URL required"); });
} else {
  const dbName = `pixl_refsettle_${randomBytes(4).toString("hex")}`;
  const admin = postgres(url,{max:1,onnotice:()=>{}});
  const u = new URL(url);u.pathname=`/${dbName}`;
  let db: postgres.Sql;
  async function user() {
    const [r]=await db<{id:string}[]>`insert into users (oauth_provider,oauth_id,display_name) values ('test',${randomBytes(6).toString("hex")},'Referral test') returning id`;
    return r.id;
  }
  async function referral(referrerId:string) {
    const referredId=await user();
    const [r]=await db<{id:number}[]>`insert into referrals (referrer_id,referred_id) values (${referrerId},${referredId}) returning id`;
    return Number(r.id);
  }
  async function settle(id:number, milestoneEvery=10, milestonePx=83) {
    const [r]=await db<{count:number}[]>`select settle_referral_reward_atomic(${id},null::bigint,'starter',40,${milestoneEvery},${milestonePx},'test') as count`;
    return Number(r.count);
  }
  async function amount(id:string,reason:string) {
    const [r]=await db<{amount:number}[]>`select coalesce(sum(amount),0)::int as amount from pixel_transactions where user_id=${id} and reason=${reason}`;
    return r.amount;
  }
  beforeAll(async()=>{
    await admin.unsafe(`create database ${dbName}`);
    const m=postgres(u.toString(),{max:1,onnotice:()=>{}});
    const dir=join(import.meta.dirname,'..','..','drizzle');
    for(const f of readdirSync(dir).filter(x=>x.endsWith('.sql')).sort()) await m.unsafe(readFileSync(join(dir,f),'utf8'));
    await m.end();db=postgres(u.toString(),{max:8,onnotice:()=>{}});
  },120_000);
  afterAll(async()=>{await db?.end();await admin.unsafe(`drop database if exists ${dbName} with (force)`);await admin.end();});

  describe('atomic referral reward and milestones',()=>{
    test('a referral pays once, and a retry does not pay twice',async()=>{
      const a=await user(), id=await referral(a);
      expect(await settle(id)).toBe(1);
      expect(await settle(id)).toBe(0);
      expect(await amount(a,'referral_reward')).toBe(40);
    });
    test('a failed wallet insert rolls back the referral claimed status',async()=>{
      const a=await user(), id=await referral(a);
      await db`create or replace function fail_referral_tx() returns trigger language plpgsql as $$ begin if new.reason='referral_reward' then raise exception 'synthetic wallet failure'; end if; return new; end; $$`;
      await db`create trigger fail_referral_tx before insert on pixel_transactions for each row execute function fail_referral_tx()`;
      try {
        await expect(settle(id)).rejects.toThrow();
        const [r]=await db`select rewarded_at from referrals where id=${id}`;
        expect(r.rewarded_at).toBeNull();
        expect(await amount(a,'referral_reward')).toBe(0);
      } finally { await db`drop trigger fail_referral_tx on pixel_transactions`; }
      expect(await settle(id)).toBe(1);
      expect(await amount(a,'referral_reward')).toBe(40);
    });
    test('concurrent referrals do not double-grant the milestone',async()=>{
      const a=await user(), [id1,id2]=[await referral(a),await referral(a)];
      const result=await Promise.all([settle(id1,2,83),settle(id2,2,83)]);
      expect(result.sort()).toEqual([1,2]);
      expect(await amount(a,'referral_reward')).toBe(80);
      expect(await amount(a,'referral_milestone')).toBe(83);
    });
    test('a milestone wallet failure rolls back referral and regular credit together',async()=>{
      const a=await user(), [id1,id2]=[await referral(a),await referral(a)];
      expect(await settle(id1,2,83)).toBe(1);
      await db`create or replace function fail_milestone_tx() returns trigger language plpgsql as $$ begin if new.reason='referral_milestone' then raise exception 'synthetic milestone failure'; end if; return new; end; $$`;
      await db`create trigger fail_milestone_tx before insert on pixel_transactions for each row execute function fail_milestone_tx()`;
      try {
        await expect(settle(id2,2,83)).rejects.toThrow();
        const [r]=await db`select rewarded_at from referrals where id=${id2}`;
        expect(r.rewarded_at).toBeNull();
        expect(await amount(a,'referral_reward')).toBe(40);
      } finally { await db`drop trigger fail_milestone_tx on pixel_transactions`; }
      expect(await settle(id2,2,83)).toBe(2);
      expect(await amount(a,'referral_reward')).toBe(80);
      expect(await amount(a,'referral_milestone')).toBe(83);
    });
  });
}
