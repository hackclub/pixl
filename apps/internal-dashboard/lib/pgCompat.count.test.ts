import { beforeAll, expect, mock, test } from "bun:test";

const queries: string[] = [];

mock.module("postgres", () => {
  const client = Object.assign(() => [], {
    unsafe: async (text: string) => {
      queries.push(text);
      return text.startsWith("select count(*)") ? [{ n: 7 }] : [{ id: 1 }, { id: 2 }];
    },
  });
  return { default: () => client };
});

let db: typeof import("./pgCompat").db;
beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://x:y@localhost:1/z";
  ({ db } = await import("./pgCompat"));
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
