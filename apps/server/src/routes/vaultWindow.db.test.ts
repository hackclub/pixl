// Hiding a settled vault chapter must not reopen its window for the next one.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("vault window tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/vaultWindow.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_vaultwin_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  const T1 = "2026-01-10T00:00:00Z";
  const T2 = "2026-02-10T00:00:00Z";
  const NEVER = 1_000_000_000;

  let db: postgres.Sql;
  let server: Server;
  let base = "";
  let currentUser = "";
  const setEnv: string[] = [];

  async function createUser(name: string): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name) values ('test', ${randomBytes(6).toString("hex")}, ${name})
      returning id`;
    return row.id;
  }

  async function approve(userId: string, at: string, hours = 10): Promise<void> {
    const [p] = await db<{ id: number }[]>`
      insert into projects (user_id, name, status, approved_hours, level)
      values (${userId}, ${`p-${randomBytes(3).toString("hex")}`}, 'approved', ${hours}, 1) returning id`;
    await db`insert into review_audits (project_id, user_id, reviewer, verdict, created_at) values (${p.id}, ${userId}, 'r', 'approved', ${at})`;
  }

  async function createLevel(position: number, opts: { unlockedAt?: string; active?: boolean; required?: number; re?: number }): Promise<number> {
    const [row] = await db<{ id: number }[]>`
      insert into vault_levels (level, energy_required, title, blurb, rewards, position, active, unlocked_at, top1_re, top2_re, top3_re)
      values (${position}, ${opts.required ?? NEVER}, ${`chapter ${position}`}, 'b', '[]'::jsonb, ${position}, ${opts.active ?? true}, ${opts.unlockedAt ?? null}, ${opts.re ?? 100}, 0, 0)
      returning id`;
    return Number(row.id);
  }

  async function awardsFor(levelId: number): Promise<string[]> {
    const rows = await db<{ user_id: string }[]>`select user_id from vault_chapter_awards where vault_level_id = ${levelId} order by award_rank`;
    return rows.map((r) => r.user_id);
  }

  async function seedThreeChapters(hideMiddle: boolean) {
    const [u1, u2, u3] = [await createUser("U1"), await createUser("U2"), await createUser("U3")];
    const chapterC = await createLevel(3, { required: NEVER });
    const chapterA = await createLevel(1, { unlockedAt: T1 });
    const chapterB = await createLevel(2, { unlockedAt: T2, active: !hideMiddle });
    await db`insert into vault_chapter_awards (vault_level_id, user_id, award_rank, re_awarded) values (${chapterA}, ${u1}, 1, 100), (${chapterB}, ${u2}, 1, 100)`;
    await approve(u1, "2026-01-05T00:00:00Z");
    await approve(u2, "2026-02-05T00:00:00Z", 40);
    await approve(u3, "2026-02-20T00:00:00Z");
    return { u1, u2, u3, chapterA, chapterB, chapterC };
  }

  async function getVault() {
    const res = await fetch(`${base}/api/vault`);
    return (await res.json()) as {
      levels: { level: number; unlocked: boolean; winners: { userId: string }[] }[];
      chapterLeaderboard: { userId: string }[];
    };
  }

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const migrator = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await migrator.unsafe(readFileSync(join(dir, file), "utf8"));
    await migrator.end();
    db = postgres(testUrl.toString(), { max: 4, onnotice: () => {} });
    if (process.env.JWT_SECRET === undefined) {
      process.env.JWT_SECRET = randomBytes(16).toString("hex");
      setEnv.push("JWT_SECRET");
    }
    const { default: vaultRouter } = await import("./vault.js");
    const pgCompat = await import("../db/pgCompat.js");
    await pgCompat.connectForTests(testUrl.toString());
    const [{ name }] = await pgCompat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { session: unknown }).session = { userId: currentUser, client: "web", displayName: "tester" };
      next();
    });
    app.use(vaultRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  beforeEach(async () => {
    await db`truncate vault_levels cascade`;
    await db`delete from review_audits`;
    await db`delete from projects`;
    currentUser = await createUser("viewer");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    const { connectForTests } = await import("../db/pgCompat.js");
    await connectForTests(null);
    for (const key of setEnv) delete process.env[key];
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("hiding a settled chapter", () => {
    test("baseline: with every chapter visible only the open window counts toward the leaderboard", async () => {
      const { u3 } = await seedThreeChapters(false);
      expect((await getVault()).chapterLeaderboard.map((r) => r.userId)).toEqual([u3]);
    });

    test("live leaderboard: a hidden settled chapter still bounds the open window", async () => {
      const { u3 } = await seedThreeChapters(true);
      const vault = await getVault();
      expect(vault.chapterLeaderboard.map((r) => r.userId)).toEqual([u3]);
      expect(vault.levels.map((l) => l.level)).toEqual([1, 3]);
    });

    test("manual closure: previously rewarded contributions are not paid again", async () => {
      const { u2, u3, chapterC } = await seedThreeChapters(true);
      const res = await fetch(`${base}/api/admin/vault/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ levelId: chapterC }),
      });
      expect(res.status).toBe(200);
      const paid = await awardsFor(chapterC);
      expect(paid).toEqual([u3]);
      expect(paid).not.toContain(u2);
    });

    test("automatic settlement: crossing the threshold pays only the open window", async () => {
      const { u2, u3, chapterC } = await seedThreeChapters(true);
      await db`update vault_levels set energy_required = 1 where id = ${chapterC}`;
      await getVault();
      const paid = await awardsFor(chapterC);
      expect(paid).toEqual([u3]);
      expect(paid).not.toContain(u2);
    });

    test("a hidden chapter does not become the open chapter for closing", async () => {
      const { chapterB } = await seedThreeChapters(true);
      const res = await fetch(`${base}/api/admin/vault/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ levelId: chapterB }),
      });
      expect(res.status).toBe(409);
    });
  });
}
