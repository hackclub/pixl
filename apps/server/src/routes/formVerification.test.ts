import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { createVerificationStore, type QueryFn, type VerificationStoreOptions } from "./formVerification.js";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("form verification tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/formVerification.test.ts",
    );
  });
} else {
  const dbName = `pixl_form_verif_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;
  let db: postgres.Sql;
  let query: QueryFn;

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const clock = { t: Date.UTC(2026, 8, 1, 12, 0, 0) };

  function makeStore(extra: VerificationStoreOptions = {}) {
    return createVerificationStore({ query, secret: "test-secret", now: () => clock.t, sweepIntervalMs: 1e9, ...extra });
  }

  let n = 0;
  const freshKey = () => `form:U${++n}${randomBytes(3).toString("hex").toUpperCase()}`;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    await db.unsafe(readFileSync(join(import.meta.dirname, "..", "..", "drizzle", "0179_form_verifications.sql"), "utf8"));
    query = async (text, params) => (await db.unsafe(text, params as never[])) as unknown as Record<string, unknown>[];
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("DB-backed verification store", () => {
    test("a key with no code ever issued cannot be verified by a guess", async () => {
      const store = makeStore();
      expect(await store.verify(freshKey(), "000000")).toBe("expired_or_missing");
    });

    test("the correct code verifies and is single use", async () => {
      const store = makeStore({ randomCode: () => "482913" });
      const key = freshKey();
      expect(await store.issue(key, "Ada")).toBe("482913");
      expect(await store.verify(key, "482913")).toBe("ok");
      expect(await store.verify(key, "482913")).toBe("expired_or_missing");
      expect(await store.peekName(key)).toBeNull();
    });

    test("only a hash of the code is stored", async () => {
      const store = makeStore({ randomCode: () => "246810" });
      const key = freshKey();
      await store.issue(key, "Ada");
      const [row] = await query("select code_hash from form_verifications where key = $1", [key]);
      expect(String(row.code_hash)).not.toContain("246810");
      expect(String(row.code_hash)).toMatch(/^[0-9a-f]{64}$/);
    });

    test("a wrong code is rejected without consuming the code", async () => {
      const store = makeStore({ randomCode: () => "222222" });
      const key = freshKey();
      await store.issue(key, "Ada");
      expect(await store.verify(key, "999999")).toBe("wrong_code");
      expect(await store.verify(key, "222222")).toBe("ok");
    });

    test("attempts are capped and the sixth try kills the code, even with the right value", async () => {
      const store = makeStore({ randomCode: () => "333333" });
      const key = freshKey();
      await store.issue(key, "Ada");
      for (let i = 0; i < 5; i++) expect(await store.verify(key, "000000")).toBe("wrong_code");
      expect(await store.verify(key, "333333")).toBe("too_many_attempts");
      expect(await store.verify(key, "333333")).toBe("expired_or_missing");
    });

    test("an expired code is unusable", async () => {
      const store = makeStore({ randomCode: () => "444444" });
      const key = freshKey();
      const start = clock.t;
      await store.issue(key, "Ada");
      clock.t = start + 10 * MIN + 1;
      expect(await store.peekName(key)).toBeNull();
      expect(await store.verify(key, "444444")).toBe("expired_or_missing");
      clock.t = start;
    });

    test("a code is bound to formKey and Slack id", async () => {
      const store = makeStore({ randomCode: () => "555555" });
      const key = freshKey();
      await store.issue(key, "Ada");
      const otherSlack = key.replace(/U/, "V");
      const otherForm = key.replace(/^form:/, "other:");
      expect(await store.verify(otherSlack, "555555")).toBe("expired_or_missing");
      expect(await store.verify(otherForm, "555555")).toBe("expired_or_missing");
      expect(await store.verify(key, "555555")).toBe("ok");
    });

    test("issue and verify work across separate store instances sharing the database", async () => {
      const a = makeStore({ randomCode: () => "121212" });
      const b = makeStore();
      const key = freshKey();
      expect(await a.issue(key, "Ada")).toBe("121212");
      expect(await b.peekName(key)).toBe("Ada");
      expect(await b.verify(key, "121212")).toBe("ok");
    });

    test("a second request inside the resend cooldown is a no-op, then works after it", async () => {
      let next = 100000;
      const store = makeStore({ randomCode: () => String(next++) });
      const key = freshKey();
      const start = clock.t;
      expect(await store.issue(key, "Ada")).toBe("100000");
      clock.t = start + 30_000;
      expect(await store.issue(key, "Ada")).toBeNull();
      expect(await store.verify(key, "100000")).toBe("ok");
      clock.t = start + MIN + 1;
      const second = await store.issue(key, "Ada");
      expect(second).not.toBeNull();
      expect(second).not.toBe("100000");
      expect(await store.verify(key, "100000")).toBe("wrong_code");
      expect(await store.verify(key, second!)).toBe("ok");
      clock.t = start;
    });

    test("repeatedly resending hits the per-Slack-id cap", async () => {
      const store = makeStore({ maxSendsPerWindow: 4 });
      const key = freshKey();
      const start = clock.t;
      const issued: (string | null)[] = [];
      for (let i = 0; i < 6; i++) {
        clock.t = start + i * (MIN + 1);
        issued.push(await store.issue(key, "Ada"));
      }
      expect(issued.filter((c) => c !== null)).toHaveLength(4);
      expect(issued.slice(4)).toEqual([null, null]);
      clock.t = start;
    });

    test("exhausting attempts does not reset the send quota", async () => {
      const store = makeStore({ maxSendsPerWindow: 3, randomCode: () => "777777" });
      const key = freshKey();
      const start = clock.t;
      const issued: (string | null)[] = [];
      for (let i = 0; i < 5; i++) {
        clock.t = start + i * (MIN + 1);
        issued.push(await store.issue(key, "Ada"));
        for (let g = 0; g < 6; g++) await store.verify(key, "000000");
      }
      expect(issued.filter((c) => c !== null)).toHaveLength(3);
      clock.t = start;
    });

    test("a successful verification does not reset the send quota", async () => {
      const store = makeStore({ maxSendsPerWindow: 2, randomCode: () => "888888" });
      const key = freshKey();
      const start = clock.t;
      expect(await store.issue(key, "Ada")).not.toBeNull();
      expect(await store.verify(key, "888888")).toBe("ok");
      clock.t = start + MIN + 1;
      expect(await store.issue(key, "Ada")).not.toBeNull();
      expect(await store.verify(key, "888888")).toBe("ok");
      clock.t = start + 2 * (MIN + 1);
      expect(await store.issue(key, "Ada")).toBeNull();
      clock.t = start;
    });

    test("the send quota resets after the window", async () => {
      const store = makeStore({ maxSendsPerWindow: 1 });
      const key = freshKey();
      const start = clock.t;
      expect(await store.issue(key, "Ada")).not.toBeNull();
      clock.t = start + 2 * MIN;
      expect(await store.issue(key, "Ada")).toBeNull();
      clock.t = start + 24 * HOUR + 1;
      expect(await store.issue(key, "Ada")).not.toBeNull();
      clock.t = start;
    });

    test("concurrent verifications of the right code succeed exactly once", async () => {
      const store = makeStore({ randomCode: () => "135791" });
      const key = freshKey();
      await store.issue(key, "Ada");
      const results = await Promise.all(Array.from({ length: 12 }, () => store.verify(key, "135791")));
      expect(results.filter((r) => r === "ok")).toHaveLength(1);
    });

    test("concurrent issues inside the cooldown send exactly one code", async () => {
      const store = makeStore();
      const key = freshKey();
      const results = await Promise.all(Array.from({ length: 12 }, () => store.issue(key, "Ada")));
      expect(results.filter((c) => c !== null)).toHaveLength(1);
    });

    test("the sweep drops rows whose window is long over and keeps recent ones", async () => {
      const store = makeStore({ sweepIntervalMs: 20 });
      const oldKey = freshKey();
      const recentKey = freshKey();
      const start = clock.t;
      clock.t = start - 3 * 24 * HOUR;
      await store.issue(oldKey, "Ada");
      clock.t = start;
      await store.issue(recentKey, "Ada");
      await new Promise((r) => setTimeout(r, 120));
      store.stopSweeping();
      const rows = await query("select key from form_verifications where key = any($1::text[])", [[oldKey, recentKey]]);
      expect(rows.map((r) => r.key)).toEqual([recentKey]);
    });
  });
}
