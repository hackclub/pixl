import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.PIXL_TEST_DATABASE_URL;
if (!url) {
  test("vault settlement needs a Postgres database", () => { throw new Error("PIXL_TEST_DATABASE_URL is required"); });
} else {
  const database = `pixl_vaultatomic_${randomBytes(4).toString("hex")}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const testUrl = new URL(url); testUrl.pathname = `/${database}`;
  let db: postgres.Sql;

  async function createUser(): Promise<string> {
    const [row] = await db<{ id: string }[]>`insert into users (oauth_provider, oauth_id, display_name)
      values ('test', ${randomBytes(6).toString("hex")}, 'vault winner') returning id`;
    return row.id;
  }
  async function createLevel(): Promise<number> {
    const [row] = await db<{ id: number }[]>`insert into vault_levels (level, energy_required, title, blurb, rewards, position, top1_re, top2_re, top3_re)
      values (${Math.floor(Math.random()*1000000000)}, 100, 'chapter', 'test', '[]'::jsonb, 0, 100, 50, 25)
      returning id`;
    return Number(row.id);
  }
  async function settle(levelId: number, awards: unknown): Promise<boolean> {
    const [row] = await db<{ settled: boolean }[]>`select settle_vault_chapter_atomic(${levelId}, ${JSON.stringify(awards)}) as settled`;
    return row.settled;
  }
  async function countAwards(id: number): Promise<number> {
    const [row] = await db<{ n: number }[]>`select count(*)::int as n from vault_chapter_awards where vault_level_id=${id}`;
    return row.n;
  }
  beforeAll(async () => {
    await admin.unsafe(`create database ${database}`);
    const m = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter(x => x.endsWith(".sql")).sort())
      await m.unsafe(readFileSync(join(dir,file), "utf8"));
    await m.end();
    db = postgres(testUrl.toString(), { max: 6, onnotice: () => {} });
  },120_000);
  afterAll(async () => {
    await db?.end();
    await admin.unsafe(`drop database if exists ${database} with (force)`);
    await admin.end();
  });
  describe("atomic Vault chapter settlement", () => {
    test("awards and closure commit together, and retries pay nothing twice", async () => {
      const id=await createLevel();const u1=await createUser();const u2=await createUser();
      const awards=[{user_id:u1,award_rank:1,re_awarded:100},{user_id:u2,award_rank:2,re_awarded:50}];
      expect(await settle(id,awards)).toBe(true);
      expect(await countAwards(id)).toBe(2);
      const [closed]=await db`select unlocked_at from vault_levels where id=${id}`;
      expect(closed.unlocked_at).not.toBeNull();
      expect(await settle(id,awards)).toBe(false);
      expect(await countAwards(id)).toBe(2);
    });
    test("one bad winner rolls back every award and the unlocked flag, permitting a retry", async () => {
      const id=await createLevel();const user=await createUser();
      const bad=[{user_id:user,award_rank:1,re_awarded:100},{user_id:randomUUID(),award_rank:2,re_awarded:50}];
      let failed=false;
      try { await settle(id,bad); } catch { failed=true; }
      expect(failed).toBe(true);
      expect(await countAwards(id)).toBe(0);
      const [unlocked]=await db`select unlocked_at from vault_levels where id=${id}`;
      expect(unlocked.unlocked_at).toBeNull();
      expect(await settle(id,[bad[0]])).toBe(true);
      expect(await countAwards(id)).toBe(1);
    });
    test("two concurrent settlement attempts create one grant set", async () => {
      const id=await createLevel();const user=await createUser();
      const awards=[{user_id:user,award_rank:1,re_awarded:100}];
      const [a,b]=await Promise.all([settle(id,awards),settle(id,awards)]);
      expect([a,b].sort()).toEqual([false,true]);
      expect(await countAwards(id)).toBe(1);
    });
    test("zero-RE chapters still close transactionally without award rows", async () => {
      const id=await createLevel();
      expect(await settle(id,[])).toBe(true);
      expect(await countAwards(id)).toBe(0);
      expect(await settle(id,[])).toBe(false);
    });
  });
}
