import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import postgres from "postgres";
import { blackoutPayout, eligibleTrackedSeconds } from "./domain.js";

const ADMIN_URL = process.env.PIXL_TEST_DATABASE_URL;
const PX = 0.07;
const SLUG = "operation-blackout";
const here = import.meta.dir;

const d = ADMIN_URL ? describe : describe.skip;

const loadSql = (rel: string) =>
  readFileSync(pathJoin(here, rel), "utf8").replace(/^\s*(BEGIN|COMMIT);\s*$/gm, "");

let admin: ReturnType<typeof postgres>;
let sql: ReturnType<typeof postgres>;
let dbName = "";
let testUrl = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function rpc(text: string, params: unknown[] = []): Promise<Json> {
  const rows = await sql.unsafe(text, params as never[]);
  return rows[0]?.r;
}

const join = (pid: number, uid: string, slug = SLUG) =>
  rpc("select operation_join($1,$2,$3) as r", [slug, pid, uid]);
const recordShip = (pid: number, uid: string) =>
  rpc("select operation_record_ship($1,$2) as r", [pid, uid]);
const requestChanges = (pid: number) => rpc("select operation_request_changes($1) as r", [pid]);
const evidence = (entryId: number, rows: Json[]) =>
  rpc("select operation_record_evidence($1,$2::jsonb) as r", [entryId, rows]);
const decide = (
  pid: number,
  decision: string,
  hours: { user_id: string; hours: number }[] = [],
  note = "looks right",
) =>
  rpc("select operation_review_decision($1,$2,$3,$4,$5,$6,$7::jsonb) as r", [
    SLUG, pid, decision, note, "reviewer", "final", hours,
  ]);
const settle = (
  pid: number,
  contribs: { user_id: string; normal_usd_rate: number; credit_hours: number; skip_reason?: string }[],
) =>
  rpc("select operation_settle_entry($1,$2,$3,$4,$5::jsonb) as r", [
    SLUG, pid, "final-reviewer", PX, contribs,
  ]);
const revert = (pid: number) => rpc("select operation_revert_entry($1,$2) as r", [pid, "admin"]);
const adminUpdate = (action: string, extra: Record<string, unknown> = {}) =>
  rpc(
    "select operation_admin_update($1,$2,$3,$4::timestamptz,$5::timestamptz,$6,$7,$8,$9,$10) as r",
    [SLUG, action, "admin", extra.endsAt ?? null, extra.startsAt ?? null, extra.name ?? null,
      extra.rate ?? null, extra.grace ?? null, "", extra.mode ?? null],
  );
const stats = () => rpc("select operation_stats($1,$2,$3) as r", [SLUG, PX, 4]);

async function mkUser(): Promise<string> {
  const [u] = await sql`insert into users (display_name) values ('t') returning id`;
  return u.id as string;
}
async function mkProject(userId: string, status = "draft"): Promise<number> {
  const [p] = await sql`insert into projects (user_id, status) values (${userId}, ${status}) returning id`;
  return Number(p.id);
}
async function setOp(
  startH: number,
  endH: number,
  opts: { rate?: number; mode?: "floor" | "additive"; grace?: number; status?: string } = {},
) {
  await sql`truncate operations restart identity cascade`;
  // Defaults match Blackout's real config: a flat +$1/hr bonus, never a
  // floor - see domain.ts's RateMode doc comment.
  await sql`insert into operations (slug, name, starts_at, ends_at, rate_usd, rate_mode, grace_period_hours, status)
    values (${SLUG}, 'Operation Blackout', now() + ${startH + " hours"}::interval,
            now() + ${endH + " hours"}::interval, ${opts.rate ?? 1}, ${opts.mode ?? "additive"},
            ${opts.grace ?? 72}, ${opts.status ?? "active"})`;
}
const entryOf = async (pid: number) =>
  (await sql`select * from operation_entries where project_id = ${pid}`)[0];
const contribOf = async (entryId: number, uid: string) =>
  (await sql`select * from operation_entry_contributors where entry_id = ${entryId} and user_id = ${uid}`)[0];
const ledger = async (uid: string) =>
  (await sql`select * from pixel_transactions where user_id = ${uid} and reason like 'operation_blackout%' order by id`);
const pixelsOf = async (uid: string) => Number((await sql`select pixels from users where id = ${uid}`)[0].pixels);

async function shippedProject(opts: { hours?: number; status?: string } = {}) {
  const uid = await mkUser();
  const pid = await mkProject(uid);
  const j = await join(pid, uid);
  expect(j.ok).toBe(true);
  await sql`update projects set status = ${opts.status ?? "shipped"} where id = ${pid}`;
  await recordShip(pid, uid);
  const entry = await entryOf(pid);
  await evidence(Number(entry.id), [
    { user_id: uid, role: "owner", hackatime_base_s: Math.round((opts.hours ?? 10) * 3600),
      journal_base_s: 0, hackatime_fix_s: 0, journal_fix_s: 0, evidence_ok: true },
  ]);
  return { uid, pid, entryId: Number(entry.id) };
}

d("operations (real Postgres)", () => {
  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 2, onnotice: () => {} });
    dbName = `pixl_ops_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.unsafe(`create database ${dbName}`);
    testUrl = ADMIN_URL!.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
    sql = postgres(testUrl, { max: 8, onnotice: () => {} });
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET ||= "test-secret";
    await sql.unsafe(loadSql("testdb/base-schema.sql"));
    await sql.unsafe(loadSql("../../drizzle/0183_operations.sql"));
    await sql.unsafe(loadSql("../../drizzle/0184_blackout_window_fix.sql"));
    await sql.unsafe(loadSql("../../drizzle/0210_blackout_withdraw_needs_changes.sql"));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 2 });
    if (admin) {
      await admin.unsafe(`drop database if exists ${dbName} with (force)`);
      await admin.end({ timeout: 2 });
    }
  });

  test("1. a user joins Blackout during the active event and joined_at is the DB clock", async () => {
    await setOp(-1, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    const r = await join(pid, uid);
    expect(r).toMatchObject({ ok: true, created: true, status: "entered" });
    const e = await entryOf(pid);
    const [{ delta }] = await sql`select abs(extract(epoch from (now() - ${e.joined_at}::timestamptz))) as delta`;
    expect(Number(delta)).toBeLessThan(5);
    expect(e.rate_usd_snapshot).toBe("1.00");
    expect(e.rate_mode_snapshot).toBe("additive");
    expect(e.grace_period_hours_snapshot).toBe(72);
    expect(e.status).toBe("entered");
  });

  test("2. joined_at cannot be backdated: no timestamp input exists, and a re-join never re-stamps", async () => {
    await setOp(-1, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await sql`update operation_entries set joined_at = now() - interval '30 minutes' where project_id = ${pid}`;
    const before = await entryOf(pid);
    const again = await join(pid, uid);
    expect(again).toMatchObject({ ok: true, created: false });
    expect(new Date((await entryOf(pid)).joined_at).getTime()).toBe(new Date(before.joined_at).getTime());
    const [{ args }] = await sql`select pg_get_function_arguments('operation_join(text,bigint,uuid)'::regprocedure) as args`;
    expect(args).toBe("p_slug text, p_project_id bigint, p_user_id uuid");
  });

  test("2b. only the owner can enter a project, and banned / in-review projects can't join", async () => {
    await setOp(-1, 24);
    const owner = await mkUser();
    const other = await mkUser();
    const pid = await mkProject(owner);
    expect((await join(pid, other)).error).toBe("project_not_found");
    const inReview = await mkProject(owner, "shipped");
    expect((await join(inReview, owner)).error).toBe("project_in_review");
    const banned = await mkProject(owner);
    await sql`update projects set banned_at = now() where id = ${banned}`;
    expect((await join(banned, owner)).error).toBe("project_banned");
  });

  test("3+4. work between join and Blackout's end counts, whenever it ships; only work not yet in the past is excluded (real evidence code, mocked Hackatime)", async () => {
    await setOp(-48, 48);
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET ||= "test-secret";
    const { recordShipForOperations } = await import("./service.js");

    const uid = await mkUser();
    await sql`update users set slack_id = 'U1', hackatime_token = 'tok' where id = ${uid}`;
    const [p] = await sql`insert into projects (user_id, status, hackatime_projects)
      values (${uid}, 'draft', ${["proj-a"]}) returning id`;
    const pid = Number(p.id);
    await join(pid, uid);
    const T = Date.now();
    await sql`update operation_entries set joined_at = to_timestamp(${(T - 3 * 3600_000) / 1000}),
      window_start = to_timestamp(${(T - 3 * 3600_000) / 1000}) where project_id = ${pid}`;
    await sql`insert into project_journals (project_id, user_id, hours, created_at) values
      (${pid}, ${uid}, 2, to_timestamp(${(T - 5 * 3600_000) / 1000})),
      (${pid}, ${uid}, 1.5, to_timestamp(${(T - 1 * 3600_000) / 1000}))`;

    const sec = (ms: number) => Math.floor((T + ms) / 1000);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ spans: [
        { start_time: sec(-4 * 3600_000), end_time: sec(-2 * 3600_000) },
        { start_time: sec(-1 * 3600_000), end_time: sec(-0.5 * 3600_000) },
      ] }), { status: 200 })) as unknown as typeof fetch;
    try {
      await sql`update projects set status = 'shipped' where id = ${pid}`;
      const r = await recordShipForOperations(pid, uid);
      expect(r).toEqual({ ok: true, entries: 1 });
    } finally {
      globalThis.fetch = realFetch;
    }
    const e = await entryOf(pid);
    const c = await contribOf(Number(e.id), uid);
    expect(c.hackatime_base_seconds).toBeGreaterThan(1.49 * 3600);
    expect(c.hackatime_base_seconds).toBeLessThan(1.51 * 3600);
    expect(c.journal_base_seconds).toBe(Math.round(1.5 * 3600));
    expect(c.eligible_tracked_seconds).toBe(c.hackatime_base_seconds + c.journal_base_seconds);
    await sql`insert into project_journals (project_id, user_id, hours, created_at)
      values (${pid}, ${uid}, 5, now() + interval '1 hour')`;
    globalThis.fetch = (async () => new Response(JSON.stringify({ spans: [] }), { status: 200 })) as unknown as typeof fetch;
    try { await recordShipForOperations(pid, uid); } finally { globalThis.fetch = realFetch; }
    const c2 = await contribOf(Number(e.id), uid);
    // Work dated in the future (relative to this reship) hasn't happened
    // yet from the window's point of view, so it's still excluded - this is
    // just "the window can't see the future", not "the window is frozen at
    // ship time".
    expect(c2.journal_base_seconds).toBe(Math.round(1.5 * 3600));

    // Now add a journal entry for work that happened *after* the first ship
    // but is already in the past by the time of a later reship: under the
    // old bug this would have been silently excluded (window frozen at the
    // first ship instant); the fix picks it up, because eligibility never
    // depended on the ship in the first place.
    await sql`insert into project_journals (project_id, user_id, hours, created_at)
      values (${pid}, ${uid}, 0.75, now() - interval '1 minute')`;
    await sql`update projects set status = 'draft' where id = ${pid}`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    globalThis.fetch = (async () => new Response(JSON.stringify({ spans: [] }), { status: 200 })) as unknown as typeof fetch;
    try { await recordShipForOperations(pid, uid); } finally { globalThis.fetch = realFetch; }
    const c3 = await contribOf(Number(e.id), uid);
    expect(c3.journal_base_seconds).toBe(Math.round(2.25 * 3600));
  });

  // The residual gap from the first window fix: evidence only used to
  // refresh on a ship/reship event, so a project shipped once and never
  // reshipped again would never pick up hours worked afterward, even though
  // they're still inside the Blackout window. refreshEntryEvidence (called
  // from the dashboard's review-decision action, not from any player
  // action) closes it: opt in -> work 4h -> ship -> work 6h more -> never
  // reship -> the reviewer's decision still sees all 10h, whether that
  // review happens after Blackout ends or while it's still active.
  test("evidence refresh at review time (no reship): 4h before ship + 6h after ship, all the way to Blackout's end", async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.JWT_SECRET ||= "test-secret";
    const { recordShipForOperations, refreshEntryEvidence } = await import("./service.js");
    const realFetch = globalThis.fetch;
    const withEmptySpans = async <T>(fn: () => Promise<T>): Promise<T> => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ spans: [] }), { status: 200 })) as unknown as typeof fetch;
      try {
        return await fn();
      } finally {
        globalThis.fetch = realFetch;
      }
    };

    async function run(reviewWhileStillActive: boolean) {
      await setOp(-30, 30);
      const uid = await mkUser();
      const pid = await mkProject(uid);
      await join(pid, uid);
      const T = Date.now();
      await sql`update operation_entries set joined_at = to_timestamp(${(T - 10 * 3600_000) / 1000}),
        window_start = to_timestamp(${(T - 10 * 3600_000) / 1000}) where project_id = ${pid}`;
      // 4h of work before shipping.
      await sql`insert into project_journals (project_id, user_id, hours, created_at) values
        (${pid}, ${uid}, 4, to_timestamp(${(T - 8 * 3600_000) / 1000}))`;

      await sql`update projects set status = 'shipped' where id = ${pid}`;
      await withEmptySpans(() => recordShipForOperations(pid, uid));

      const entry = await entryOf(pid);
      const before = await contribOf(Number(entry.id), uid);
      expect(before.journal_base_seconds).toBe(4 * 3600);
      expect(entry.reship_count).toBe(0);

      // 6h more of work AFTER shipping, still inside Blackout - the player
      // never reships.
      await sql`insert into project_journals (project_id, user_id, hours, created_at) values
        (${pid}, ${uid}, 6, to_timestamp(${(T - 2 * 3600_000) / 1000}))`;

      await sql`update operations set ends_at = ${
        reviewWhileStillActive ? sql`now() + interval '100 hours'` : sql`now() - interval '30 minutes'`
      } where slug = ${SLUG}`;

      // The reviewer opens the entry: this is the refresh a real review
      // decision triggers (apps/dashboard's applyBlackoutDecision), not
      // anything the player did.
      const r = await withEmptySpans(() => refreshEntryEvidence(Number(entry.id)));
      expect(r.ok).toBe(true);

      expect((await entryOf(pid)).reship_count).toBe(0); // confirms no reship happened
      const after = await contribOf(Number(entry.id), uid);
      expect(after.journal_base_seconds).toBe(10 * 3600);
      expect(after.eligible_tracked_seconds).toBe(10 * 3600);

      expect((await decide(pid, "eligible", [{ user_id: uid, hours: 10 }])).ok).toBe(true);
      expect(Number((await contribOf(Number(entry.id), uid)).approved_blackout_hours)).toBe(10);
    }

    await run(false); // review after Blackout has ended
    await run(true); // review while Blackout is still active
  });

  test("4b. shipping after Blackout ends still qualifies for review - it just can't earn hours past ends_at", async () => {
    await setOp(-2, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await sql`update operations set ends_at = now() - interval '1 minute' where slug = ${SLUG}`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    const r = await recordShip(pid, uid);
    const e = await entryOf(pid);
    // Shipping time never gates eligibility: the entry ships normally and
    // goes to review, same as any on-time ship.
    expect(e.status).toBe("shipped");
    expect(e.first_qualified_ship_at).not.toBeNull();
    expect(e.decided_by).toBe("");
    // But the window handed back for evidence-gathering is capped at
    // ends_at, not the (later) ship instant - hours worked after Blackout
    // ended never make it into the eligible total.
    expect(new Date(r.entries[0].window_end).getTime()).toBe(
      new Date((await sql`select ends_at from operations where slug = ${SLUG}`)[0].ends_at).getTime(),
    );
  });

  test("shipping while the operation is admin-ended still qualifies and is capped the same way", async () => {
    await setOp(-2, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await adminUpdate("end");
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, uid);
    const e = await entryOf(pid);
    expect(e.status).toBe("shipped");
    expect(e.first_qualified_ship_at).not.toBeNull();
  });

  test("opt-in midway through Blackout: window_start is joined_at, not the operation start", async () => {
    await setOp(-48, 48);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    // Simulate joining partway through the window: joined_at/window_start
    // land well after the operation actually started (-48h).
    const midpoint = await sql`select now() - interval '10 hours' as t`;
    await sql`update operation_entries set joined_at = ${midpoint[0].t}, window_start = ${midpoint[0].t} where project_id = ${pid}`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    const r = await recordShip(pid, uid);
    expect(new Date(r.entries[0].window_start).getTime()).toBe(new Date(midpoint[0].t).getTime());
  });

  test("reviewing (deciding + settling) long after Blackout ends still pays normally", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 6 });
    await sql`update operations set ends_at = now() - interval '5 days', starts_at = now() - interval '12 days' where slug = ${SLUG}`;
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 6 }])).ok).toBe(true);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 6 }]);
    expect(r.ok).toBe(true);
    expect(r.paid_px).toBeGreaterThan(0);
    expect((await entryOf(pid)).status).toBe("approved");
  });

  test("boundary: once ends_at has passed, a reship's window_end is pinned exactly to ends_at, not to reship time", async () => {
    await setOp(-2, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    const r1 = await recordShip(pid, uid);
    expect(new Date(r1.entries[0].window_end).getTime()).toBeLessThan(
      new Date((await sql`select ends_at from operations where slug = ${SLUG}`)[0].ends_at).getTime(),
    );
    await sql`update operations set ends_at = now() - interval '1 hour' where slug = ${SLUG}`;
    const opRow = (await sql`select ends_at from operations where slug = ${SLUG}`)[0];
    await sql`update projects set status = 'draft' where id = ${pid}`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    const r2 = await recordShip(pid, uid);
    expect((await entryOf(pid)).status).toBe("shipped");
    expect(new Date(r2.entries[0].window_end).getTime()).toBe(new Date(opRow.ends_at).getTime());
  });

  test("5. shipped before the deadline but reviewed days after the event still qualifies and pays", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 6 });
    await sql`update operations set ends_at = now() - interval '2 days', starts_at = now() - interval '9 days' where slug = ${SLUG}`;
    await sql`update operation_entries set first_qualified_ship_at = now() - interval '2 days 1 hour' where project_id = ${pid}`;
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 6 }])).ok).toBe(true);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 6 }]);
    expect(r.ok).toBe(true);
    expect(r.paid_px).toBeGreaterThan(0);
    expect((await entryOf(pid)).status).toBe("approved");
  });

  test("6. unship/reship never resets the first Blackout ship or the join", async () => {
    await setOp(-2, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, uid);
    const first = await entryOf(pid);
    await sql`update projects set status = 'draft' where id = ${pid}`;
    await sql`select pg_sleep(1.1)`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, uid);
    const second = await entryOf(pid);
    expect(new Date(second.first_qualified_ship_at).getTime()).toBe(new Date(first.first_qualified_ship_at).getTime());
    expect(new Date(second.joined_at).getTime()).toBe(new Date(first.joined_at).getTime());
    expect(second.rate_usd_snapshot).toBe(first.rate_usd_snapshot);
    expect(new Date(second.latest_ship_at).getTime()).toBeGreaterThan(new Date(second.first_qualified_ship_at).getTime());
    expect(second.status).toBe("shipped");
    expect((await rpc("select operation_withdraw($1,$2,$3) as r", [SLUG, pid, uid])).error).toBe("cannot_withdraw");
  });

  test("7. a reviewer can't approve more hours than the trusted evidence allows", async () => {
    await setOp(-2, 24);
    const { uid, pid, entryId } = await shippedProject({ hours: 4 });
    const over = await decide(pid, "eligible", [{ user_id: uid, hours: 4.5 }]);
    expect(over).toMatchObject({ ok: false, error: "exceeds_eligible", max_hours: 4 });
    expect((await contribOf(entryId, uid)).approved_blackout_hours).toBeNull();
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 4 }])).ok).toBe(true);
    expect(Number((await contribOf(entryId, uid)).approved_blackout_hours)).toBe(4);
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: -1 }])).error).toBe("invalid_hours");
    expect((await decide(pid, "eligible", [{ user_id: await mkUser(), hours: 1 }])).error).toBe("unknown_contributor");
  });

  test("8+9. normal $4 -> $5 effective (+$1 bonus); permanent user fields and the normal payout are untouched", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await sql`insert into pixel_transactions (user_id, project_id, amount, hours, reason) values (${uid}, ${pid}, 5714, 10, 'project_approved')`;
    await sql`update users set pixels = 5714 where id = ${uid}`;
    const userBefore = (await sql`select * from users where id = ${uid}`)[0];
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    const ts = blackoutPayout({ approvedHours: 10, eligibleHours: 10, creditHours: 10, normalUsdRate: 4, rateUsd: 1, rateMode: "additive", pxValueUsd: PX });
    expect(ts.effectiveUsdRate).toBe(5); // 4 + 1 bonus
    expect(r.contributors[0].effective_usd_rate).toBe(5);
    expect(Number(r.contributors[0].uplift_px)).toBe(ts.upliftPx);
    expect(Number(r.contributors[0].gross_px)).toBe(ts.grossPx);
    expect(ts.grossPx).toBe(714);
    expect(ts.upliftPx).toBe(143);
    const userAfter = (await sql`select * from users where id = ${uid}`)[0];
    const { pixels: pa, ...restAfter } = userAfter;
    const { pixels: pb, ...restBefore } = userBefore;
    expect(restAfter).toEqual(restBefore);
    expect(Number(pa)).toBe(Number(pb) + ts.upliftPx);
    const normal = await sql`select amount from pixel_transactions where reason = 'project_approved' and user_id = ${uid}`;
    expect(normal.map((n) => Number(n.amount))).toEqual([5714]);
    const rows = await ledger(uid);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("operation_blackout");
    expect(Number(rows[0].operation_id)).toBeGreaterThan(0);
    expect(rows[0].meta).toMatchObject({ hours: 10, normal_usd_rate: 4, effective_usd_rate: 5 });
  });

  // The old "floor" model paid a $6/hr earner nothing (6 already met the
  // $5 minimum). The corrected additive model pays every eligible
  // contributor the same +$1/hr bonus regardless of their own rate - a
  // $6/hr earner still gets +$1, same as everyone else.
  test("10. a $6/hr earner still gets the +$1/hr bonus (no floor semantics)", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 6, credit_hours: 10 }]);
    expect(r.ok).toBe(true);
    expect(r.contributors[0]).toMatchObject({ effective_usd_rate: 7, uplift_px: 143 });
    expect(await ledger(uid)).toHaveLength(1);
    expect(await pixelsOf(uid)).toBe(143);
    expect((await entryOf(pid)).status).toBe("approved");
  });

  test("11. team members are paid separately from their own hours and rates - each gets their own +$1/hr", async () => {
    await setOp(-2, 24);
    const a = await mkUser(), b = await mkUser(), c = await mkUser();
    const pid = await mkProject(a);
    await join(pid, a);
    await sql`insert into project_collaborators (project_id, user_id) values (${pid}, ${b}), (${pid}, ${c})`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, a);
    const entryId = Number((await entryOf(pid)).id);
    const row = (uid: string, role: string, h: number) => ({ user_id: uid, role, hackatime_base_s: h * 3600, journal_base_s: 0, hackatime_fix_s: 0, journal_fix_s: 0, evidence_ok: true });
    await evidence(entryId, [row(a, "owner", 6), row(b, "collaborator", 3), row(c, "collaborator", 5)]);
    expect((await decide(pid, "eligible", [{ user_id: a, hours: 6 }, { user_id: b, hours: 3 }, { user_id: c, hours: 5 }])).ok).toBe(true);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [
      { user_id: a, normal_usd_rate: 4, credit_hours: 6 },
      { user_id: b, normal_usd_rate: 4.5, credit_hours: 3 },
      { user_id: c, normal_usd_rate: 6, credit_hours: 5 },
    ]);
    const byUser = new Map<string, Json>(r.contributors.map((x: Json) => [x.user_id, x]));
    expect(Number(byUser.get(a).paid_hours)).toBe(6);
    expect(Number(byUser.get(b).paid_hours)).toBe(3);
    expect(Number(byUser.get(c).paid_hours)).toBe(5);
    expect(Number(byUser.get(a).uplift_px)).toBe(blackoutPayout({ approvedHours: 6, eligibleHours: 6, creditHours: 6, normalUsdRate: 4, rateUsd: 1, rateMode: "additive", pxValueUsd: PX }).upliftPx);
    expect(Number(byUser.get(b).uplift_px)).toBe(blackoutPayout({ approvedHours: 3, eligibleHours: 3, creditHours: 3, normalUsdRate: 4.5, rateUsd: 1, rateMode: "additive", pxValueUsd: PX }).upliftPx);
    // Under a floor, c (already at $6, above the old $5 minimum) got
    // nothing. Under the corrected additive +$1/hr bonus, c gets one too.
    expect(Number(byUser.get(c).uplift_px)).toBe(
      blackoutPayout({ approvedHours: 5, eligibleHours: 5, creditHours: 5, normalUsdRate: 6, rateUsd: 1, rateMode: "additive", pxValueUsd: PX }).upliftPx,
    );
    expect(Number(byUser.get(c).uplift_px)).toBeGreaterThan(0);
    expect((await stats()).contributors.approved_hours).toBe(14);
    expect(await ledger(c)).toHaveLength(1);
    expect(await ledger(a)).toHaveLength(1);
    expect(await ledger(b)).toHaveLength(1);
  });

  test("11b. Blackout pay is capped by the hours the person was normally credited", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 4 }]);
    expect(Number(r.contributors[0].paid_hours)).toBe(4);
  });

  test("12. a duplicate or concurrent approval can never double-pay", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const contribs = [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }];
    const results = await Promise.all([settle(pid, contribs), settle(pid, contribs), settle(pid, contribs)]);
    expect(results.every((x: Json) => x.ok)).toBe(true);
    expect(results.filter((x: Json) => x.already_settled)).toHaveLength(2);
    expect(await ledger(uid)).toHaveLength(1);
    const again = await settle(pid, contribs);
    expect(again).toMatchObject({ ok: true, already_settled: true, paid_px: 0 });
    expect(await ledger(uid)).toHaveLength(1);
    expect(await pixelsOf(uid)).toBe(143);
    const key = (await ledger(uid))[0].meta ? `operation_blackout:${(await entryOf(pid)).id}:${uid}:1` : "";
    await expect(
      (async () => {
        await sql`insert into pixel_transactions (user_id, project_id, amount, reason, dedupe_key) values (${uid}, ${pid}, 1, 'operation_blackout', ${key})`;
      })(),
    ).rejects.toThrow(/pixel_tx_dedupe_key/);
  });

  test("12b. a reviewer re-deciding after payout cannot change it", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    expect((await decide(pid, "ineligible", [], "changed my mind")).error).toBe("entry_locked");
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 1 }])).error).toBe("entry_locked");
  });

  test("13. an ineligible entry pays $0, and the reviewer must say why", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    expect((await decide(pid, "ineligible", [], "  ")).error).toBe("reason_required");
    expect((await decide(pid, "ineligible", [], "theme mismatch")).ok).toBe(true);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    expect(r).toMatchObject({ ok: true, ineligible: true, paid_px: 0 });
    expect(await ledger(uid)).toHaveLength(0);
    expect((await entryOf(pid)).status).toBe("ineligible");
  });

  test("13b. settlement refuses an undecided entry and an unapproved project", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 5 });
    expect((await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 5 }])).error).toBe("no_eligibility_decision");
    await decide(pid, "eligible", [{ user_id: uid, hours: 5 }]);
    expect((await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 5 }])).error).toBe("project_not_approved");
    expect(await ledger(uid)).toHaveLength(0);
  });

  test("14. needs-changes keeps eligibility and grants a bounded grace window, not a second Blackout", async () => {
    await setOp(-2, 24, { grace: 72 });
    const { uid, pid, entryId } = await shippedProject({ hours: 4 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 4 }]);
    const first = await entryOf(pid);
    await sql`update projects set status = 'needs_changes' where id = ${pid}`;
    await requestChanges(pid);
    const nc = await entryOf(pid);
    expect(nc.status).toBe("needs_changes");
    expect(nc.eligibility_decision).toBeNull();
    expect(new Date(nc.first_qualified_ship_at).getTime()).toBe(new Date(first.first_qualified_ship_at).getTime());
    const hoursToDeadline = (new Date(nc.grace_deadline).getTime() - new Date(nc.changes_requested_at).getTime()) / 3600_000;
    expect(hoursToDeadline).toBeCloseTo(72, 3);
    expect(await contribOf(entryId, uid).then((c) => c.approved_blackout_hours)).toBeNull();

    await sql`update projects set status = 'shipped' where id = ${pid}`;
    const ship = await recordShip(pid, uid);
    const after = await entryOf(pid);
    expect(after.status).toBe("shipped");
    expect(after.reship_count).toBe(1);
    expect(new Date(after.first_qualified_ship_at).getTime()).toBe(new Date(first.first_qualified_ship_at).getTime());
    expect(after.fix_window_end).not.toBeNull();
    expect(ship.entries[0].fix_window_end).not.toBeNull();

    await evidence(entryId, [{ user_id: uid, role: "owner", hackatime_base_s: 4 * 3600, journal_base_s: 0, hackatime_fix_s: 20 * 3600, journal_fix_s: 0, evidence_ok: true }]);
    const c = await contribOf(entryId, uid);
    expect(c.eligible_tracked_seconds).toBe(5 * 3600);
    expect(c.eligible_tracked_seconds).toBe(eligibleTrackedSeconds(4 * 3600, 20 * 3600));
    await evidence(entryId, [{ user_id: uid, role: "owner", hackatime_base_s: 10 * 3600, journal_base_s: 0, hackatime_fix_s: 40 * 3600, journal_fix_s: 0, evidence_ok: true }]);
    expect((await contribOf(entryId, uid)).eligible_tracked_seconds).toBe(12.5 * 3600);
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 12.6 }])).error).toBe("exceeds_eligible");
    expect((await decide(pid, "eligible", [{ user_id: uid, hours: 12.5 }])).ok).toBe(true);
  });

  test("14b. a reship after the grace deadline does not extend the fix window past the deadline", async () => {
    await setOp(-2, 24, { grace: 72 });
    const { uid, pid } = await shippedProject({ hours: 4 });
    await sql`update operation_entries set first_qualified_ship_at = now() - interval '6 hours',
      window_start = now() - interval '9 hours', joined_at = now() - interval '9 hours' where project_id = ${pid}`;
    await sql`update projects set status = 'needs_changes' where id = ${pid}`;
    await requestChanges(pid);
    await sql`update operation_entries set grace_deadline = now() - interval '1 hour' where project_id = ${pid}`;
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, uid);
    const e = await entryOf(pid);
    expect(e.status).toBe("shipped");
    expect(new Date(e.fix_window_end).getTime()).toBe(new Date(e.grace_deadline).getTime());
    expect(new Date(e.fix_window_end).getTime()).toBeLessThan(Date.now() - 30 * 60_000);
    expect(new Date(e.fix_window_end).getTime()).toBeGreaterThan(new Date(e.first_qualified_ship_at).getTime());
  });

  test("15. paused, ended, and not-yet-started operations refuse new entries", async () => {
    const uid = await mkUser();
    const cases: [string, () => Promise<void>][] = [
      ["paused", () => setOp(-1, 24, { status: "paused" })],
      ["ended", () => setOp(-1, 24, { status: "ended" })],
      ["ended", () => setOp(-48, -1)],
      ["upcoming", () => setOp(5, 24, { status: "upcoming" })],
    ];
    for (const [expected, arrange] of cases) {
      await arrange();
      const pid = await mkProject(uid);
      const r = await join(pid, uid);
      expect(r).toMatchObject({ ok: false, error: "not_accepting_entries", operation_status: expected });
      expect(await entryOf(pid)).toBeUndefined();
    }
    await setOp(-1, 24);
    expect((await adminUpdate("pause")).ok).toBe(true);
    expect((await join(await mkProject(uid), uid)).error).toBe("not_accepting_entries");
    expect((await adminUpdate("resume")).ok).toBe(true);
    expect((await join(await mkProject(uid), uid)).ok).toBe(true);
  });

  test("15b. an entered project can still ship while entries are paused", async () => {
    await setOp(-1, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    await adminUpdate("pause");
    await sql`update projects set status = 'shipped' where id = ${pid}`;
    await recordShip(pid, uid);
    expect((await entryOf(pid)).status).toBe("shipped");
  });

  test("16. extending, editing, and ending never rewrite what an entry already recorded", async () => {
    await setOp(-2, 24, { rate: 5 });
    const { pid } = await shippedProject({ hours: 3 });
    const before = await entryOf(pid);
    expect((await adminUpdate("extend", { endsAt: new Date(Date.now() + 5 * 86400_000).toISOString() })).ok).toBe(true);
    expect((await adminUpdate("edit", { rate: 9, grace: 12, name: "Renamed" })).ok).toBe(true);
    const mid = await entryOf(pid);
    for (const k of ["joined_at", "window_start", "first_qualified_ship_at", "rate_usd_snapshot", "grace_period_hours_snapshot"]) {
      expect(String(mid[k])).toBe(String(before[k]));
    }
    expect(mid.rate_usd_snapshot).toBe("5.00");
    const uid2 = await mkUser();
    const pid2 = await mkProject(uid2);
    await join(pid2, uid2);
    expect((await entryOf(pid2)).rate_usd_snapshot).toBe("9.00");
    expect((await adminUpdate("extend", { endsAt: new Date(Date.now() + 3600_000).toISOString() })).error).toBe("must_extend_later");
    expect((await adminUpdate("edit", { endsAt: new Date(Date.now() - 3600_000).toISOString() })).error).toBe("would_cut_shipped_entries");
    expect((await adminUpdate("edit", { startsAt: new Date(Date.now() + 3600_000).toISOString() })).error).toBe("start_locked");
    expect((await adminUpdate("end")).ok).toBe(true);
    const op = (await sql`select * from operations where slug = ${SLUG}`)[0];
    expect(op.status).toBe("ended");
    expect(new Date(op.ends_at).getTime()).toBeGreaterThanOrEqual(new Date(before.first_qualified_ship_at).getTime());
    const after = await entryOf(pid);
    expect(String(after.first_qualified_ship_at)).toBe(String(before.first_qualified_ship_at));
    expect((await join(await mkProject(await mkUser()), uid2)).ok).toBe(false);
    const audit = await sql`select action from operation_audit where operation_id = ${op.id} order by id`;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["admin_extend", "admin_edit", "admin_end", "entry_joined", "first_ship"]));
  });

  test("19. the Blackout entry survives normal project state transitions", async () => {
    await setOp(-2, 24);
    const uid = await mkUser();
    const pid = await mkProject(uid);
    await join(pid, uid);
    const id0 = (await entryOf(pid)).id;
    for (const status of ["shipped", "draft", "shipped", "second_review", "needs_changes", "shipped", "approved"]) {
      await sql`update projects set status = ${status} where id = ${pid}`;
      if (status === "shipped") await recordShip(pid, uid);
      if (status === "needs_changes") await requestChanges(pid);
      const e = await entryOf(pid);
      expect(e.id).toBe(id0);
      expect(e.first_qualified_ship_at ?? e.status === "entered").toBeTruthy();
    }
    await rpc("select operation_on_project_ban($1) as r", [pid]);
    const e = await entryOf(pid);
    expect(e.status).toBe("ineligible");
    expect(e.system_reason).toBe("Project banned");
  });

  test("top-up examples: 1 approved hour at $4 adds about $1, at $5 and $6 adds nothing", async () => {
    await setOp(-2, 24);
    const out: Record<number, { uplift: number; rows: number }> = {};
    for (const normal of [4, 5, 6]) {
      const { uid, pid } = await shippedProject({ hours: 1 });
      await decide(pid, "eligible", [{ user_id: uid, hours: 1 }]);
      await sql`update projects set status = 'approved' where id = ${pid}`;
      const r = await settle(pid, [{ user_id: uid, normal_usd_rate: normal, credit_hours: 1 }]);
      out[normal] = { uplift: Number(r.contributors[0].uplift_px), rows: (await ledger(uid)).length };
    }
    expect(out[4].uplift).toBe(14);
    expect(out[4].uplift * PX).toBeCloseTo(1, 1);
    expect(out[4].rows).toBe(1);
    expect(out[5]).toEqual({ uplift: 0, rows: 0 });
    expect(out[6]).toEqual({ uplift: 0, rows: 0 });
  });

  test("normal payout plus top-up lands on the floor, and the cost stat counts only the top-up", async () => {
    await setOp(-2, 24, { rate: 5 });
    const { uid, pid } = await shippedProject({ hours: 10 });
    const normalPx = Math.round((10 * 4) / PX);
    await sql`insert into pixel_transactions (user_id, project_id, amount, hours, reason) values (${uid}, ${pid}, ${normalPx}, 10, 'project_approved')`;
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    const [{ total }] = await sql`select sum(amount) as total from pixel_transactions where user_id = ${uid}`;
    expect((Number(total) * PX) / 10).toBeCloseTo(5, 1);
    const s = await stats();
    expect(Number(s.actual_uplift_usd)).toBeCloseTo(143 * PX, 2);
    expect(Number(s.actual_gross_usd)).toBeCloseTo(714 * PX, 2);
    expect(Number(s.actual_uplift_usd)).toBeLessThan(Number(s.actual_gross_usd) / 4);
  });

  test("clawback: reverting removes only the operation top-up, the normal payout rows are untouched, no duplicate on re-settle", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await sql`insert into pixel_transactions (user_id, project_id, amount, hours, reason) values (${uid}, ${pid}, 571, 10, 'project_approved')`;
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    await revert(pid);
    await sql`insert into pixel_transactions (user_id, project_id, amount, reason) values (${uid}, ${pid}, -571, 'review_reverted')`;
    const byReason = await sql`select reason, sum(amount) as amt, count(*) as n from pixel_transactions where user_id = ${uid} group by reason order by reason`;
    const m = Object.fromEntries(byReason.map((r) => [r.reason, [Number(r.amt), Number(r.n)]]));
    expect(m.project_approved).toEqual([571, 1]);
    expect(m.review_reverted).toEqual([-571, 1]);
    expect(m.operation_blackout).toEqual([143, 1]);
    expect(m.operation_blackout_reverted).toEqual([-143, 1]);
    const [{ total }] = await sql`select sum(amount) as total from pixel_transactions where user_id = ${uid}`;
    expect(Number(total)).toBe(0);
    const s = await stats();
    expect(Number(s.actual_uplift_usd)).toBe(0);
  });

  test("revert: a re-review voids the top-up with a reversal row, and a fresh decision pays once more", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    expect(await pixelsOf(uid)).toBe(143);
    const r = await revert(pid);
    expect(r.ok).toBe(true);
    expect(await pixelsOf(uid)).toBe(0);
    let rows = await ledger(uid);
    expect(rows.map((x) => [x.reason, Number(x.amount)])).toEqual([["operation_blackout", 143], ["operation_blackout_reverted", -143]]);
    expect((await entryOf(pid)).status).toBe("shipped");
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10 }]);
    rows = await ledger(uid);
    expect(rows).toHaveLength(3);
    expect(await pixelsOf(uid)).toBe(143);
    expect(rows.reduce((s, x) => s + Number(x.amount), 0)).toBe(143);
  });

  test("trial hold: a skip_reason settles the person at $0 without a payout", async () => {
    await setOp(-2, 24);
    const { uid, pid } = await shippedProject({ hours: 10 });
    await decide(pid, "eligible", [{ user_id: uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${pid}`;
    const r = await settle(pid, [{ user_id: uid, normal_usd_rate: 4, credit_hours: 10, skip_reason: "trial_prize_hold" }]);
    expect(r.contributors[0]).toMatchObject({ skipped: "trial_prize_hold", uplift_px: 0 });
    expect(await ledger(uid)).toHaveLength(0);
    expect(Number((await stats()).trial_held_skips)).toBe(1);
  });

  test("20. projected/actual cost stats match the underlying transactions", async () => {
    // rate:1 (additive) is Blackout's real config. With an assumed $4
    // baseline (p_base_payout_usd), pending.gross_usd (3h * (4+1)=15) and
    // pending.uplift_max_usd (3h * 1=3) below land on the same numbers a
    // $5 floor happened to produce here - additive's estimate is exact
    // (no assumption needed for the bonus itself), unlike floor's.
    await setOp(-2, 24, { rate: 1, mode: "additive" });
    const paid = await shippedProject({ hours: 10 });
    await decide(paid.pid, "eligible", [{ user_id: paid.uid, hours: 10 }]);
    await sql`update projects set status = 'approved' where id = ${paid.pid}`;
    await settle(paid.pid, [{ user_id: paid.uid, normal_usd_rate: 4, credit_hours: 10 }]);
    const pending = await shippedProject({ hours: 3 });
    const inel = await shippedProject({ hours: 2 });
    await decide(inel.pid, "ineligible", [], "off theme");
    await mkProject(await mkUser());
    const notShipped = await mkUser();
    await join(await mkProject(notShipped), notShipped);

    const s = await stats();
    const [{ net }] = await sql`select coalesce(sum(amount),0) as net from pixel_transactions
      where operation_id = (select id from operations where slug = ${SLUG}) and reason in ('operation_blackout','operation_blackout_reverted')`;
    expect(Number(s.ledger.net_uplift_px)).toBe(Number(net));
    expect(Number(s.contributors.uplift_px)).toBe(Number(net));
    expect(Number(s.actual_uplift_usd)).toBeCloseTo(Number(net) * PX, 2);
    expect(s.entries).toMatchObject({ entries: 4, approved: 1, ineligible: 1, shipped_entries: 3, pending_review: 1, not_shipped: 1 });
    expect(Number(s.contributors.approved_hours)).toBe(10);
    expect(Number(s.power_units)).toBe(10);
    expect(Number(s.pending.hours)).toBeCloseTo(3, 5);
    expect(Number(s.pending.gross_usd)).toBeCloseTo(15, 5);
    expect(Number(s.pending.uplift_max_usd)).toBeCloseTo(3, 5);
    expect(Number(s.projected_gross_usd)).toBeCloseTo(Number(s.actual_gross_usd) + 15, 2);
    expect(Number(s.participants)).toBe(3);
    void pending;
  });

  test("payout math in SQL and TS agree across a matrix of rates and hours (additive mode)", async () => {
    await setOp(-2, 24);
    // Explicitly includes every rate the user's spec called out ($4, $4.31,
    // $5, $6) plus a wider spread, and both single-hour and 10h cases.
    for (const normal of [4, 4.31, 4.37, 4.99, 5, 5.01, 5.5, 6]) {
      for (const hours of [0.25, 1, 2.75, 7.33, 10, 12]) {
        const { uid, pid } = await shippedProject({ hours: 20 });
        await decide(pid, "eligible", [{ user_id: uid, hours }]);
        await sql`update projects set status = 'approved' where id = ${pid}`;
        const r = await settle(pid, [{ user_id: uid, normal_usd_rate: normal, credit_hours: hours }]);
        const ts = blackoutPayout({ approvedHours: hours, eligibleHours: 20, creditHours: hours, normalUsdRate: normal, rateUsd: 1, rateMode: "additive", pxValueUsd: PX });
        expect(ts.effectiveUsdRate).toBeCloseTo(normal + 1, 10); // exactly +$1/hr before rounding
        expect(Number(r.contributors[0].uplift_px)).toBe(ts.upliftPx);
        expect(Number(r.contributors[0].gross_px)).toBe(ts.grossPx);
        expect(Number(r.contributors[0].effective_usd_rate)).toBeCloseTo(ts.effectiveUsdRate, 4);
      }
    }
  });

  test("payout math in SQL and TS agree across a matrix of rates and hours (floor mode, kept generic)", async () => {
    await setOp(-2, 24, { rate: 5, mode: "floor" });
    for (const normal of [4, 4.37, 4.99, 5, 5.01, 5.5, 6]) {
      for (const hours of [0.25, 1, 2.75, 7.33, 12]) {
        const { uid, pid } = await shippedProject({ hours: 20 });
        await decide(pid, "eligible", [{ user_id: uid, hours }]);
        await sql`update projects set status = 'approved' where id = ${pid}`;
        const r = await settle(pid, [{ user_id: uid, normal_usd_rate: normal, credit_hours: hours }]);
        const ts = blackoutPayout({ approvedHours: hours, eligibleHours: 20, creditHours: hours, normalUsdRate: normal, rateUsd: 5, rateMode: "floor", pxValueUsd: PX });
        expect(Number(r.contributors[0].uplift_px)).toBe(ts.upliftPx);
        expect(Number(r.contributors[0].gross_px)).toBe(ts.grossPx);
        expect(Number(r.contributors[0].effective_usd_rate)).toBeCloseTo(ts.effectiveUsdRate, 4);
      }
    }
  });

describe("operations HTTP routes (real router, real Postgres)", () => {
  let server: import("node:http").Server;
  let base = "";
  let token: (uid: string) => string;
  let db2: ReturnType<typeof postgres>;

  beforeAll(async () => {
    db2 = sql;
    await setOp(-1, 48);
    const { default: express } = await import("express");
    const { default: router } = await import("../routes/operations.js");
    const { issueSessionToken } = await import("../auth/session.js");
    token = (uid) => issueSessionToken({ userId: uid, displayName: "t" });
    const app = express();
    app.use(express.json());
    app.use(router);
    await new Promise<void>((res) => { server = app.listen(0, () => res()); });
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  });

  afterAll(() => {
    server?.close();
  });

  async function newProject(): Promise<{ uid: string; pid: number }> {
    const [u] = await db2`insert into users (display_name) values ('t') returning id`;
    const [p] = await db2`insert into projects (user_id) values (${u.id}) returning id`;
    return { uid: u.id as string, pid: Number(p.id) };
  }
  const post = (path: string, tok: string | null, body: unknown) =>
    fetch(`${base}${path}?${tok ? `token=${tok}` : ""}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });

  test("17. unauthenticated and non-owner callers can't enter, and there is no route to change eligibility", async () => {
    const { uid, pid } = await newProject();
    expect((await post(`/api/operations/${SLUG}/entries`, null, { projectId: pid })).status).toBe(401);
    const { uid: stranger } = await newProject();
    const res = await post(`/api/operations/${SLUG}/entries`, token(stranger), { projectId: pid });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("project_not_found");
    expect((await db2`select count(*)::int as n from operation_entries where project_id = ${pid}`)[0].n).toBe(0);
    const { default: router } = await import("../routes/operations.js");
    const routes = (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
      .filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods)[0]} ${l.route!.path}`).sort();
    expect(routes).toEqual([
      "delete /api/operations/:slug/entries/:projectId",
      "get /api/operations/:slug",
      "post /api/operations/:slug/entries",
    ]);
    expect((await fetch(`${base}/api/operations/${SLUG}/entries/${pid}/decision`, { method: "POST" })).status).toBe(404);
    expect(uid).toBeTruthy();
  });

  test("18. the client cannot forge the operation, rate, or timestamps", async () => {
    const { uid, pid } = await newProject();
    const res = await post(`/api/operations/${SLUG}/entries`, token(uid), {
      projectId: pid, operationId: 999, campaignId: 999, rate: 100, rateUsd: 100,
      joinedAt: "2020-01-01T00:00:00Z", joined_at: "2020-01-01T00:00:00Z",
      windowStart: "2020-01-01T00:00:00Z", firstQualifiedShipAt: "2020-01-01T00:00:00Z", status: "approved",
    });
    expect(res.status).toBe(200);
    const [e] = await db2`select * from operation_entries where project_id = ${pid}`;
    expect(e.rate_usd_snapshot).toBe("1.00");
    expect(e.rate_mode_snapshot).toBe("additive");
    expect(e.status).toBe("entered");
    expect(e.first_qualified_ship_at).toBeNull();
    expect(new Date(e.joined_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(Number(e.operation_id)).not.toBe(999);
    expect((await post(`/api/operations/Not_A_Slug/entries`, token(uid), { projectId: pid })).status).toBe(404);
    expect((await post(`/api/operations/nope/entries`, token(uid), { projectId: pid })).status).toBe(404);
  });

  test("public status hides the briefing before the start and never leaks per-player data anonymously", async () => {
    await db2`insert into operations (slug, name, starts_at, ends_at) values ('operation-later', 'Later', now() + interval '3 days', now() + interval '6 days')`;
    const later = await (await fetch(`${base}/api/operations/operation-later`)).json();
    expect(later.operation).toMatchObject({ status: "upcoming", briefingUnlocked: false });
    expect(later.operation.rateUsd).toBeUndefined();
    expect(later.operation.endsAt).toBeUndefined();
    expect(later.entries).toBeUndefined();

    const live = await (await fetch(`${base}/api/operations/${SLUG}`)).json();
    expect(live.operation).toMatchObject({ status: "active", briefingUnlocked: true, rateUsd: 1, rateMode: "additive", gracePeriodHours: 72 });
    expect(live.operation.power).toBeDefined();
    expect(live.entries).toBeUndefined();

    const { uid, pid } = await newProject();
    await post(`/api/operations/${SLUG}/entries`, token(uid), { projectId: pid });
    const mine = await (await fetch(`${base}/api/operations/${SLUG}?token=${token(uid)}`)).json();
    expect(mine.entries).toHaveLength(1);
    expect(mine.entries[0]).toMatchObject({ projectId: pid, label: "entered" });
    expect(Object.keys(mine.entries[0]).sort()).toEqual(["firstShipAt", "graceDeadline", "joinedAt", "label", "projectId"]);
  });

  test("withdraw works before the first Blackout ship and during a fix window, never mid-review", async () => {
    const { uid, pid } = await newProject();
    await post(`/api/operations/${SLUG}/entries`, token(uid), { projectId: pid });
    const del = (p: number) => fetch(`${base}/api/operations/${SLUG}/entries/${p}?token=${token(uid)}`, { method: "DELETE" });
    const count = async () => (await db2`select count(*)::int as n from operation_entries where project_id = ${pid}`)[0].n;
    expect((await del(pid)).status).toBe(200);
    expect(await count()).toBe(0);
    await post(`/api/operations/${SLUG}/entries`, token(uid), { projectId: pid });
    await db2`update projects set status = 'shipped' where id = ${pid}`;
    await db2`select operation_record_ship(${pid}, ${uid})`;
    expect((await del(pid)).status).toBe(400);

    await db2`update projects set status = 'needs_changes' where id = ${pid}`;
    await db2`select operation_request_changes(${pid})`;
    const nonOwner = await newProject();
    const delAs = (u: string) => fetch(`${base}/api/operations/${SLUG}/entries/${pid}?token=${token(u)}`, { method: "DELETE" });
    expect((await delAs(nonOwner.uid)).status).toBe(400);
    expect((await del(pid)).status).toBe(200);
    expect(await count()).toBe(0);
    const [audit] = await db2`select actor, detail from operation_audit
      where action = 'entry_withdrawn' and (detail->>'project_id')::bigint = ${pid}`;
    expect(audit.actor).toBe(uid);
  });

  test("withdraw refuses a fix-window entry with a settled contributor", async () => {
    const { uid, pid } = await newProject();
    await post(`/api/operations/${SLUG}/entries`, token(uid), { projectId: pid });
    await db2`update projects set status = 'shipped' where id = ${pid}`;
    await db2`select operation_record_ship(${pid}, ${uid})`;
    await db2`update projects set status = 'needs_changes' where id = ${pid}`;
    await db2`select operation_request_changes(${pid})`;
    const [{ id: entryId }] = await db2`select id from operation_entries where project_id = ${pid}`;
    await db2`insert into operation_entry_contributors (entry_id, user_id, role, settled_at)
      values (${entryId}, ${uid}, 'owner', now())
      on conflict (entry_id, user_id) do update set settled_at = now()`;
    const r = await fetch(`${base}/api/operations/${SLUG}/entries/${pid}?token=${token(uid)}`, { method: "DELETE" });
    expect(r.status).toBe(400);
  });
});
});
