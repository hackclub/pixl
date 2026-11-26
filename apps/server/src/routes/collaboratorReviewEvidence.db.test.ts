import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.PIXL_TEST_DATABASE_URL;
if (!url) {
  test("collaborator evidence guard requires a test Postgres", () => {
    throw new Error("PIXL_TEST_DATABASE_URL is required for collaborator evidence DB tests");
  });
} else {
  const dbName = `pixl_collablock_${randomBytes(4).toString("hex")}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  const databaseUrl = new URL(url); databaseUrl.pathname = `/${dbName}`;
  let db: postgres.Sql;
  async function fixture(status: string) {
    const [user] = await db<{ id: string }[]>`insert into users (oauth_provider, oauth_id, display_name)
      values ('test', ${randomBytes(6).toString("hex")}, 'builder') returning id`;
    const [project] = await db<{ id: number }[]>`insert into projects (user_id, name, status)
      values (${user.id}, 'review lock test', ${status}) returning id`;
    const [collab] = await db<{ id: number }[]>`insert into project_collaborators (project_id, user_id, invited_by, status)
      values (${project.id}, ${user.id}, ${user.id}, 'accepted') returning id`;
    return { projectId: project.id, collaboratorId: collab.id };
  }
  async function updateEvidence(id: number): Promise<string | null> {
    try {
      await db`update project_collaborators set hackatime_projects = ARRAY['demo']::text[], hackatime_seconds = 3600 where id = ${id}`;
      return null;
    } catch (e) { return (e as { code?: string }).code ?? "unknown"; }
  }
  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const migrator = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
      await migrator.unsafe(readFileSync(join(dir, file), "utf8"));
    await migrator.end();
    db = postgres(databaseUrl.toString(), { max: 6, onnotice: () => {} });
  }, 120_000);
  afterAll(async () => {
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });
  describe("collaborator Hackatime evidence freeze", () => {
    test("drafts, approved updates and needs-changes remain editable", async () => {
      for (const status of ["draft", "needs_changes", "approved"]) {
        const row = await fixture(status);
        expect(await updateEvidence(row.collaboratorId)).toBeNull();
      }
    });
    test("all active review stages reject collaborator evidence edits", async () => {
      for (const status of ["shipped", "fraud_review", "second_review"]) {
        const row = await fixture(status);
        expect(await updateEvidence(row.collaboratorId)).toBe("23514");
        const [actual] = await db`select cardinality(hackatime_projects) as n from project_collaborators where id = ${row.collaboratorId}`;
        expect(Number(actual.n)).toBe(0);
      }
    });
    test("a concurrent ship holds the status lock ahead of an evidence update", async () => {
      const row = await fixture("draft");
      let release!: () => void;
      let ready!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      const held = new Promise<void>((resolve) => { ready = resolve; });
      const shipping = db.begin(async (tx) => {
        await tx`update projects set status='shipped' where id = ${row.projectId}`;
        ready(); await hold;
      });
      await held;
      const attempt = updateEvidence(row.collaboratorId);
      try {
        const deadline = Date.now() + 5000;
        for (;;) {
          const waiting = await db`select 1 from pg_stat_activity where datname=current_database()
            and wait_event_type='Lock' and query ilike '%update project_collaborators set hackatime_projects%'`;
          if (waiting.length) break;
          if (Date.now() > deadline) throw new Error("collaborator update did not block on project lock");
          await new Promise((r) => setTimeout(r, 25));
        }
      } finally { release(); }
      await shipping;
      expect(await attempt).toBe("23514");
    });
  });
}
