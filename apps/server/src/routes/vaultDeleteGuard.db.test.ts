// Migration 0233 against a real Postgres: a settled vault chapter can't be deleted.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("vault delete guard tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/vaultDeleteGuard.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_vaultdel_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;
  let db: postgres.Sql;

  async function createLevel(rewards = 100): Promise<number> {
    const [row] = await db<{ id: number }[]>`
      insert into vault_levels (level, energy_required, title, blurb, rewards, position, top1_re, top2_re, top3_re)
      values (${Math.floor(Math.random() * 1e9)}, 100, 't', 'b', '[]'::jsonb, 0, ${rewards}, 0, 0)
      returning id`;
    return Number(row.id);
  }

  async function createUser(): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name) values ('test', ${randomBytes(6).toString("hex")}, 'tester')
      returning id`;
    return row.id;
  }

  async function award(levelId: number): Promise<void> {
    const userId = await createUser();
    await db`insert into vault_chapter_awards (vault_level_id, user_id, award_rank, re_awarded) values (${levelId}, ${userId}, 1, 100)`;
  }

  async function exists(levelId: number): Promise<boolean> {
    const rows = await db`select 1 from vault_levels where id = ${levelId}`;
    return rows.length === 1;
  }

  async function tryDelete(client: postgres.Sql | postgres.TransactionSql, levelId: number): Promise<string | null> {
    try {
      await client`delete from vault_levels where id = ${levelId}`;
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? "unknown";
    }
  }

  async function waitUntilBlocked(fragment: string): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const rows = await db`
        select 1 from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query ilike ${`%${fragment}%`}`;
      if (rows.length > 0) return;
      if (Date.now() > deadline) throw new Error(`nothing blocked on a lock for: ${fragment}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const migrator = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
      await migrator.unsafe(readFileSync(join(dir, file), "utf8"));
    await migrator.end();
    db = postgres(testUrl.toString(), { max: 6, onnotice: () => {} });
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("vault level delete guard", () => {
    test("an unused goal can still be deleted", async () => {
      const id = await createLevel();
      expect(await tryDelete(db, id)).toBeNull();
      expect(await exists(id)).toBe(false);
    });

    test("a goal that paid out is refused and its awards survive", async () => {
      const id = await createLevel();
      await award(id);
      expect(await tryDelete(db, id)).toBe("23001");
      expect(await exists(id)).toBe(true);
      const [n] = await db<{ n: number }[]>`select count(*)::int n from vault_chapter_awards where vault_level_id = ${id}`;
      expect(n.n).toBe(1);
    });

    test("a claimed goal with RE configured is refused before its awards land", async () => {
      const id = await createLevel();
      await db`update vault_levels set unlocked_at = now() where id = ${id}`;
      expect(await tryDelete(db, id)).toBe("23001");
      expect(await exists(id)).toBe(true);
    });

    test("a claimed goal with no RE configured can be deleted", async () => {
      const id = await createLevel(0);
      await db`update vault_levels set unlocked_at = now() where id = ${id}`;
      expect(await tryDelete(db, id)).toBeNull();
    });

    test("the foreign key itself refuses to cascade away awards", async () => {
      const id = await createLevel();
      await award(id);
      await db`alter table vault_levels disable trigger vault_levels_block_settled_delete`;
      try {
        expect(await tryDelete(db, id)).toBe("23503");
      } finally {
        await db`alter table vault_levels enable trigger vault_levels_block_settled_delete`;
      }
      expect(await exists(id)).toBe(true);
    });

    test("a delete racing a settlement claim loses once the claim commits", async () => {
      const id = await createLevel();
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      let claimed!: () => void;
      const claimedP = new Promise<void>((r) => (claimed = r));
      const settle = db.begin(async (tx) => {
        await tx`update vault_levels set unlocked_at = now() where id = ${id} and unlocked_at is null`;
        claimed();
        await hold;
      });
      await claimedP;
      const racing = tryDelete(db, id);
      await waitUntilBlocked("delete from vault_levels");
      release();
      await settle;
      expect(await racing).toBe("23001");
      expect(await exists(id)).toBe(true);
    });

    test("a settlement racing a delete that committed first claims nothing", async () => {
      const id = await createLevel();
      let release!: () => void;
      const hold = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      const deleting = db.begin(async (tx) => {
        await tx`delete from vault_levels where id = ${id}`;
        locked();
        await hold;
      });
      await lockedP;
      const claim = db`update vault_levels set unlocked_at = now() where id = ${id} and unlocked_at is null returning id`.execute();
      await waitUntilBlocked("update vault_levels set unlocked_at");
      release();
      await deleting;
      expect((await claim).length).toBe(0);
      expect(await exists(id)).toBe(false);
    });
  });
}
