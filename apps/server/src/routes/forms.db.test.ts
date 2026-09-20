import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import postgres from "postgres";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("forms route tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/routes/forms.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_forms_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  let db: postgres.Sql;
  let server: Server;
  let base = "";
  const setEnv: string[] = [];
  let previousSlackToken: string | undefined;
  const realFetch = globalThis.fetch;
  const dms: { channel: string; text: string }[] = [];
  const knownSlackIds = new Set<string>();

  const FORM = "review";
  const ORIGIN = { origin: "https://pixl.hackclub.com", "content-type": "application/json" };

  async function post(path: string, body: unknown) {
    const res = await realFetch(`${base}${path}`, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  const requestCode = (slackId: string) => post(`/api/forms/${FORM}/request-code`, { slackId });
  const submit = (slackId: string, code: string) =>
    post(`/api/forms/${FORM}/submit`, { slackId, code, answers: { why: "because" } });
  const codesFor = (slackId: string) =>
    dms.filter((d) => d.channel === slackId).flatMap((d) => (/\*(\d{6})\*/.exec(d.text) ? [/\*(\d{6})\*/.exec(d.text)![1]] : []));

  let slackCounter = 0;
  const newSlackId = (known = true) => {
    const id = `U${(++slackCounter).toString().padStart(3, "0")}${randomBytes(4).toString("hex").toUpperCase()}`;
    if (known) knownSlackIds.add(id);
    return id;
  };

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }
    await db`insert into form_configs (form_key, title, questions, close_at)
      values (${FORM}, 'Review', ${db.json([{ key: "why", label: "Why?" }])}, null)
      on conflict (form_key) do update set questions = excluded.questions, close_at = null`;

    for (const [key, value] of [
      ["JWT_SECRET", randomBytes(16).toString("hex")],
    ] as const) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        setEnv.push(key);
      }
    }
    previousSlackToken = process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    const { default: formsRouter } = await import("./forms.js");
    const pgCompat = await import("../db/pgCompat.js");
    await pgCompat.connectForTests(testUrl.toString());
    const [{ name }] = await pgCompat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.startsWith("https://slack.com/api/users.info")) {
        const id = new URL(href).searchParams.get("user") ?? "";
        return Response.json(
          knownSlackIds.has(id) ? { ok: true, user: { profile: { display_name: `Name-${id}` } } } : { ok: false },
        );
      }
      if (href.startsWith("https://slack.com/api/chat.postMessage")) {
        dms.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
      }
      return realFetch(url as string, init);
    }) as typeof fetch;

    const app = express();
    app.use(express.json());
    app.use(formsRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    const { connectForTests } = await import("../db/pgCompat.js");
    await connectForTests(null);
    for (const key of setEnv) delete process.env[key];
    if (previousSlackToken === undefined) delete process.env.SLACK_BOT_TOKEN;
    else process.env.SLACK_BOT_TOKEN = previousSlackToken;
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  describe("public form Slack verification (route + Postgres)", () => {
    test("request a code, receive it by DM, submit successfully", async () => {
      const slackId = newSlackId();
      expect((await requestCode(slackId)).body).toEqual({ ok: true });
      const [code] = codesFor(slackId);
      expect(code).toMatch(/^\d{6}$/);
      const res = await submit(slackId, code);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      const rows = await db`select name, status from form_submissions where slack_id = ${slackId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe(`Name-${slackId}`);
    });

    test("the code cannot be used twice", async () => {
      const slackId = newSlackId();
      await requestCode(slackId);
      const [code] = codesFor(slackId);
      expect((await submit(slackId, code)).status).toBe(200);
      const again = await submit(slackId, code);
      expect(again.status).toBe(400);
      expect(again.body.error).toBe("code_expired_or_missing");
    });

    test("a wrong code is refused and the real code still works afterwards", async () => {
      const slackId = newSlackId();
      await requestCode(slackId);
      const [code] = codesFor(slackId);
      const wrong = code === "000000" ? "000001" : "000000";
      expect((await submit(slackId, wrong)).body.error).toBe("invalid_code");
      expect((await submit(slackId, code)).status).toBe(200);
    });

    test("knowing a Slack id is not enough: a code sent to one id fails for another", async () => {
      const victim = newSlackId();
      const attacker = newSlackId();
      await requestCode(victim);
      const [victimCode] = codesFor(victim);
      const res = await submit(attacker, victimCode);
      expect(res.body.error).toBe("code_expired_or_missing");
      expect(await db`select 1 from form_submissions where slack_id = ${attacker}`).toHaveLength(0);
    });

    test("an unknown Slack id gets the same response and no DM", async () => {
      const ghost = newSlackId(false);
      const known = newSlackId();
      const a = await requestCode(ghost);
      const b = await requestCode(known);
      expect(a).toEqual(b);
      expect(codesFor(ghost)).toHaveLength(0);
      expect(codesFor(known)).toHaveLength(1);
    });

    test("repeated requests inside the cooldown send one DM and look identical", async () => {
      const slackId = newSlackId();
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await requestCode(slackId));
      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(codesFor(slackId)).toHaveLength(1);
    });
  });
}
