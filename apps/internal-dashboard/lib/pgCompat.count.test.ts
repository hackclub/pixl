import { afterAll, beforeAll, expect, test } from "bun:test";
import { db, sql } from "./pgCompat";

const queries: string[] = [];
const client = sql as unknown as { unsafe: (text: string) => Promise<unknown> };
let original: typeof client.unsafe;
let hadUrl: string | undefined;

beforeAll(() => {
  hadUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL ??= "postgres://x:y@127.0.0.1:1/z";
  original = client.unsafe;
  client.unsafe = async (text: string) => {
    queries.push(text);
    return text.startsWith("select count(*)") ? [{ n: 7 }] : [{ id: 1 }, { id: 2 }];
  };
});

afterAll(() => {
  client.unsafe = original;
  if (hadUrl === undefined) delete process.env.DATABASE_URL;
});

test("a head count runs only the count query, never fetching rows", async () => {
  queries.length = 0;
  const { count, error } = await db.from("projects").select("id", { count: "exact", head: true }).eq("status", "shipped");
  expect(error).toBeNull();
  expect(count).toBe(7);
  expect(queries).toHaveLength(1);
  expect(queries[0]).toStartWith("select count(*)");
});

test("rows plus a count run both queries", async () => {
  queries.length = 0;
  const { data, count } = await db.from("projects").select("id", { count: "exact" }).eq("status", "shipped");
  expect(count).toBe(7);
  expect((data as unknown[]).length).toBe(2);
  expect(queries).toHaveLength(2);
});

test("a plain select without a count runs one query and reports no count", async () => {
  queries.length = 0;
  const { data, count } = await db.from("projects").select("id").eq("status", "shipped");
  expect(count).toBeNull();
  expect((data as unknown[]).length).toBe(2);
  expect(queries).toHaveLength(1);
});
