import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { rankedIdeas } from "./ideasRank";

const url = process.env.PIXL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("idea ranking and deduplicated applications", () => {
  const name = "pixl_ideas_" + randomBytes(5).toString("hex");
  const admin = postgres(url!, { max: 1, onnotice: () => {} });
  let db: ReturnType<typeof postgres>;
  beforeAll(async () => {
    await admin.unsafe("create database " + name);
    const u = new URL(url!); u.pathname = "/" + name;
    db = postgres(u.toString(), { max: 3, onnotice: () => {} });
    await db.unsafe(`
      create table users (id uuid primary key);
      create table ideas (id bigint primary key, user_id uuid, title text, created_at timestamptz, banned_at timestamptz);
      create table idea_upvotes (idea_id bigint, voter_id uuid);
      create table idea_downvotes (idea_id bigint, voter_id uuid);
      insert into ideas (id, title, created_at)
        select g, 'Idea ' || g, now() + g * interval '1 hour'
        from generate_series(1, 205) as g;
      insert into idea_upvotes (idea_id, voter_id)
        select 1, ('00000000-0000-4000-8000-' || lpad(g::text,12,'0'))::uuid
        from generate_series(1, 10) as g;
    `);
    await db.unsafe(readFileSync(join(import.meta.dir, "../../drizzle/0237_idea_collab_applications.sql"), "utf8"));
  });
  afterAll(async () => { await db?.end(); await admin.unsafe("drop database " + name + " with (force)"); await admin.end(); });
  test("top-ranked older idea is not discarded by newest-first truncation", async () => {
    const rows = await rankedIdeas("", db);
    expect(rows).toHaveLength(200);
    expect(Number(rows[0]!.id)).toBe(1);
  });
  test("application insert is unique per user and idea", async () => {
    const user = "11111111-1111-4111-8111-111111111111";
    await db`insert into users(id) values (${user})`;
    const first = await db`insert into idea_collab_applications (idea_id, user_id) values (1, ${user})
      on conflict do nothing returning idea_id`;
    const second = await db`insert into idea_collab_applications (idea_id, user_id) values (1, ${user})
      on conflict do nothing returning idea_id`;
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
