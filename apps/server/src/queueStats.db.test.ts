import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("queue stats tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/queueStats.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_queue_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  let db: postgres.Sql;
  let loadQueueStats: typeof import("./queueStats.js").loadQueueStats;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }
    if (process.env.JWT_SECRET === undefined) process.env.JWT_SECRET = randomBytes(16).toString("hex");
    const pgCompat = await import("./db/pgCompat.js");
    await pgCompat.connectForTests(testUrl.toString());
    ({ loadQueueStats } = await import("./queueStats.js"));
  });

  afterAll(async () => {
    if (db) await db.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  const now = Date.parse("2026-11-27T12:00:00Z");
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();

  async function seed() {
    const [user] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name)
      values ('test', ${randomBytes(6).toString("hex")}, 'tester')
      returning id`;

    const project = async (status: string, type: string, firstShippedDays: number) => {
      const [row] = await db<{ id: number }[]>`
        insert into projects (user_id, name, status, project_type, first_shipped_at)
        values (${user.id}::uuid, ${`p-${status}-${type}`}, ${status}, ${type}, ${at(firstShippedDays)})
        returning id`;
      return row.id;
    };
    const verdict = async (projectId: number, v: string, days: number) => {
      await db`
        insert into review_audits (project_id, user_id, reviewer, verdict, created_at)
        values (${projectId}::bigint, ${user.id}::uuid, 'tester', ${v}, ${at(days)})`;
    };

    // shipped exactly 30 days before its verdict (the verdict is 2h ago)
    const softwareWaiting = await project("shipped", "web", 30 + 2 / 24);
    const hardwareWaiting = await project("shipped", "hardware", 40);
    const finalCheck = await project("second_review", "cad", 20);
    await project("needs_changes", "web", 10);

    await verdict(softwareWaiting, "approved", 2 / 24);
    await verdict(hardwareWaiting, "approved", 8);
    await verdict(finalCheck, "needs_changes", 3);
  }

  describe("loadQueueStats", () => {
    test("counts queue, one-shot pace and turnaround from real rows", async () => {
      await seed();
      const stats = await loadQueueStats(now);
      expect(stats.queue).toEqual({
        total: 3,
        waiting: { total: 2, software: 1, hardware: 1 },
        final_checks: { total: 1, software: 0, hardware: 1 },
      });
      expect(stats.activity.reviewed_24h).toEqual({ approved: 1, needs_changes: 0 });
      expect(stats.activity.reviewed_7d).toEqual({
        approved: 1,
        needs_changes: 1,
        approval_rate: 50,
      });
      expect(stats.activity.pace).toEqual({
        software: { reviews_per_day: 0.1, eta_days: 10 },
        hardware: { reviews_per_day: 0.1, eta_days: 10 },
      });
      expect(stats.activity.turnaround).toEqual({ median_days: 30, sample_size: 3 });
      expect(stats.activity.daily.at(-1)).toEqual({
        date: "2026-11-27",
        approved: 1,
        needs_changes: 0,
      });
      expect(stats.generated_at).toBe("2026-11-27T12:00:00.000Z");
    });
  });
}
