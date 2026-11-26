import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { withWritableJournalProject } from "./journalLock";

const url = process.env.PIXL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("journal review lock", () => {
  const database = "pixl_journal_" + randomBytes(5).toString("hex");
  const admin = postgres(url!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    await admin.unsafe("create database " + database);
    const target = new URL(url!); target.pathname = "/" + database;
    db = postgres(target.toString(), { max: 4, onnotice: () => {} });
    await db.unsafe("create table projects (id bigint primary key, status text not null); create table project_journals (id bigserial primary key, project_id bigint references projects(id), content text); insert into projects (id,status) values (1,'draft'),(2,'shipped')");
  });
  afterAll(async () => { await db?.end(); await admin.unsafe("drop database " + database + " with (force)"); await admin.end(); });
  test("refuses writes when a project is already under review", async () => {
    const r = await withWritableJournalProject(2, async tx => tx`insert into project_journals (project_id,content) values (2,'late')`, db);
    expect(r).toEqual({ ok: false, reason: "project_in_review" });
    expect(await db`select id from project_journals`).toHaveLength(0);
  });
  test("a ship transition waits for a journal transaction and then freezes evidence", async () => {
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(r => { release = r; });
    const ready = new Promise<void>(r => { entered = r; });
    const insert = withWritableJournalProject(1, async tx => {
      entered();
      await blocked;
      await tx`insert into project_journals (project_id,content) values (1,'early')`;
      return true;
    }, db);
    await ready;
    const shipping = db`update projects set status = 'shipped' where id = 1 returning status`;
    release();
    expect((await insert).ok).toBe(true);
    expect((await shipping)[0]?.status).toBe("shipped");
    const late = await withWritableJournalProject(1, async tx => tx`insert into project_journals (project_id,content) values (1,'late')`, db);
    expect(late).toEqual({ ok: false, reason: "project_in_review" });
    expect(await db`select content from project_journals`).toHaveLength(1);
  });
});
