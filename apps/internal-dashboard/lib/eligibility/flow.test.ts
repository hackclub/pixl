import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { claimOrderWithFunding, claimRpcArgs, evidenceSnapshot, refreshCommitmentAmount } from "./commit";
import { clearAirtableCache, evaluateFromEvidence, evaluateOrders, loadPlayerEvidence, toOrderInput, type SqlLike, type UnifiedVerifier } from "./evidence";
import type { SubmissionLookup } from "../airtable";
import { POLICIES } from "./policy";
import { buildSnapshot, type ShipsProvider } from "./ships";

const NOW = 1_800_000_000_000;
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const REC_A = "recAAAAAAAAAAAAAA";
const REC_B = "recBBBBBBBBBBBBBB";

interface Tables {
  owned?: Record<string, unknown>[];
  collab?: Record<string, unknown>[];
  orders?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[] | "missing" | "error";
  audits?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  payouts?: Record<string, unknown>[];
  reviewerTransactions?: Record<string, unknown>[] | "missing" | "error";
  reviewPayouts?: Record<string, unknown>[] | "error";
}

function fakeSql(t: Tables, queries: string[] = []): SqlLike {
  const f = (strings: unknown, ...vals: unknown[]) => {
    if (!(strings && typeof strings === "object" && "raw" in (strings as object))) return strings;
    const text = (strings as TemplateStringsArray).join("?");
    void vals;
    queries.push(text);
    if (text.includes("fulfillment_commitments")) {
      if (t.ledger === "missing") return Promise.reject(Object.assign(new Error("no table"), { code: "42P01" }));
      if (t.ledger === "error") return Promise.reject(Object.assign(new Error("boom"), { code: "XX000" }));
      return Promise.resolve(t.ledger ?? []);
    }
    if (text.includes("pixel_transactions") && text.includes("review_payout_backfill")) {
      if (t.reviewerTransactions === "missing") return Promise.reject(Object.assign(new Error("no table"), { code: "42P01" }));
      if (t.reviewerTransactions === "error") return Promise.reject(Object.assign(new Error("boom"), { code: "XX000" }));
      return Promise.resolve(t.reviewerTransactions ?? []);
    }
    if (text.includes("pixel_transactions")) return Promise.resolve(t.payouts ?? []);
    if (text.includes("from review_payouts")) {
      if (t.reviewPayouts === "error") return Promise.reject(Object.assign(new Error("boom"), { code: "XX000" }));
      return Promise.resolve(t.reviewPayouts ?? []);
    }
    if (text.includes("from users")) return Promise.resolve(t.users ?? []);
    if (text.includes("project_collaborators")) return Promise.resolve(t.collab ?? []);
    if (text.includes("review_audits")) return Promise.resolve(t.audits ?? []);
    if (text.includes("from shop_orders")) return Promise.resolve(t.orders ?? []);
    if (text.includes("from projects")) return Promise.resolve(t.owned ?? []);
    return Promise.resolve([]);
  };
  return f as unknown as SqlLike;
}

const payout = (over: Record<string, unknown> = {}) => ({ id: 1, user_id: U1, project_id: 1, amount: 400, hours: 10, reason: "project_approved", ...over });
const reviewerTransaction = (over: Record<string, unknown> = {}) => ({
  id: "9001",
  user_id: U1,
  project_id: null,
  amount: 300,
  reason: "review_payout",
  ...over,
});

const proj = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: "Proj",
  user_id: U1,
  status: "approved",
  approved_hours: "10",
  banned_at: null,
  repo_url: "https://github.com/a/b",
  airtable_record_id: REC_A,
  system_note: "",
  funding_usd: 0,
  needs_funding: false,
  funding_deducted_px: 0,
  hours_deflated_at: null,
  ...over,
});

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 100,
  user_id: U1,
  item_name: "Keyboard",
  quantity: 1,
  price: 100,
  status: "pending",
  actual_cost_usd: null,
  flagged_at: null,
  ...over,
});

const confirming: UnifiedVerifier = {
  available: true,
  verify: async (refs) => new Map(refs.map((r) => [`${r.userId}:${r.projectId}`, { state: "confirmed" as const, ref: `u-${r.projectId}` }])),
};

const realFetch = globalThis.fetch;
const realToken = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
let calls: { url: string; method: string }[] = [];

const SUBMITTED = "2\u2013Submitted";

function stubAirtable(handler: (url: string) => Response) {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return handler(String(url));
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN = "test-token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realToken === undefined) delete process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
  else process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN = realToken;
});

describe("evidence loading", () => {
  test("collects owned and collaborator projects, deflation history and prior grants", async () => {
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false,
      sql: fakeSql({
        owned: [proj({ id: 1, hours_deflated_at: "2026-10-01", approved_hours: "4", funding_usd: "15", needs_funding: true, funding_deducted_px: 150 })],
        collab: [{ id: 2, name: "Shared", status: "approved", banned_at: null, repo_url: "https://github.com/c/d", system_note: "", funding_usd: 0, hours_deflated_at: null, collab_user_id: U1, collab_hours: "3", collab_record_id: REC_B }],
        audits: [{ project_id: 1, claimed_hours: "10" }],
      }),
      now: NOW,
    });
    const p = ev.get(U1)!;
    expect(p.projects.map((x) => [x.projectId, x.role, x.approvedHours])).toEqual([[1, "owner", 4], [2, "collaborator", 3]]);
    expect(p.projects[0]!.originalHours).toBe(10);
    expect(p.priorGrants).toEqual([{ projectId: 1, name: "Proj", usd: 15, deductedPx: 150, ambiguous: false }]);
  });

  describe("project funding grants", () => {
    const grantName = "Hardware funding grant , Proj";
    const funded = (over: Record<string, unknown> = {}) => proj({ funding_usd: "20", needs_funding: true, funding_deducted_px: 150, ...over });
    const load = (tables: Tables) => loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql(tables), verifier: confirming, now: NOW });
    const eval1 = (ev: Awaited<ReturnType<typeof load>>, row: Record<string, unknown>) =>
      evaluateFromEvidence(ev.get(U1)!, toOrderInput(row as never), POLICIES["2026-10-22.1"], NOW);

    test("a requested but unapproved grant counts nothing", async () => {
      const ev = await load({ owned: [proj({ funding_usd: "20", needs_funding: true, funding_deducted_px: 0 })] });
      expect(ev.get(U1)!.priorGrants).toEqual([]);
    });

    test("a grant that has its shop order is counted once, by the order, at the approved dollar amount", async () => {
      const row = orderRow({ id: 5, item_name: grantName, price: 150, quantity: 1 });
      const ev = await load({ owned: [funded()], orders: [row] });
      expect(ev.get(U1)!.priorGrants).toEqual([]);
      const r = eval1(ev, row);
      expect(r.amount).toMatchObject({ cents: 2000, basis: "face", budgetCents: 1500 });
      expect(r.reasons.map((x) => x.code)).toContain("amount_discrepancy");
      expect(r.committedCents).toBe(0);
      expect(r.status).toBe("covered");
    });

    test("a claimed grant order counts as one commitment against the player's next order", async () => {
      const grant = orderRow({ id: 5, item_name: grantName, price: 150, status: "ordered" });
      const next = orderRow({ id: 6, price: 100 });
      const ev = await load({ owned: [funded()], orders: [grant, next] });
      const r = eval1(ev, next);
      expect(r.committedCents).toBe(2000);
      expect(r.priorGrantCents).toBe(0);
    });

    test("a cancelled grant order frees its funds and is not re-counted as a prior grant", async () => {
      const grant = orderRow({ id: 5, item_name: grantName, price: 150, status: "cancelled" });
      const next = orderRow({ id: 6, price: 100 });
      const ev = await load({ owned: [funded()], orders: [grant, next] });
      expect(ev.get(U1)!.priorGrants).toEqual([]);
      expect(eval1(ev, next).committedCents).toBe(0);
    });

    test("an approved grant with no order is a prior grant at the approved dollar amount", async () => {
      const ev = await load({ owned: [funded()] });
      expect(ev.get(U1)!.priorGrants).toEqual([{ projectId: 1, name: "Proj", usd: 20, deductedPx: 150, ambiguous: false }]);
      expect(eval1(ev, orderRow({ id: 9, price: 100 })).priorGrantCents).toBe(2000);
    });

    test("a second order for the same grant is flagged for review", async () => {
      const a = orderRow({ id: 5, item_name: grantName, price: 150 });
      const b = orderRow({ id: 6, item_name: grantName, price: 150 });
      const ev = await load({ owned: [funded()], orders: [a, b] });
      expect(eval1(ev, a).reasons.map((x) => x.code)).not.toContain("duplicate_funding_order");
      const rb = eval1(ev, b);
      expect(rb.status).toBe("review_required");
      expect(rb.reasons.map((x) => x.code)).toContain("duplicate_funding_order");
    });

    test("a renamed project leaves an unlinkable order and forces review instead of silent double counting", async () => {
      const stray = orderRow({ id: 5, item_name: "Hardware funding grant , Old Name", price: 150 });
      const ev = await load({ owned: [funded()], orders: [stray] });
      expect(ev.get(U1)!.priorGrants[0]!.ambiguous).toBe(true);
      expect(eval1(ev, stray).status).toBe("review_required");
    });

    test("two projects with the same name cannot both claim one order", async () => {
      const a = orderRow({ id: 5, item_name: grantName, price: 150 });
      const ev = await load({ owned: [funded({ id: 1 }), funded({ id: 2, repo_url: "https://github.com/x/y" })], orders: [a] });
      const grants = ev.get(U1)!.priorGrants;
      expect(grants).toHaveLength(1);
      expect(grants[0]!.ambiguous).toBe(true);
    });

    test("the funding order name written by the review action matches the matcher", () => {
      const src = readFileSync(join(import.meta.dir, "../../app/actions.ts"), "utf8");
      expect(src).toContain("item_name: `${FUNDING_ORDER_PREFIX}${project.name}`");
    });
  });

  test("bigint ids returned as strings by Postgres still key the results by number", async () => {
    const rows = [orderRow({ id: "11" }), orderRow({ id: "12", price: 50 })] as never[];
    const results = await evaluateOrders(rows, { liveAirtable: false, verifier: confirming, sql: fakeSql({ owned: [proj({ airtable_record_id: null })], orders: rows, payouts: [payout()] }) });
    expect([...results.keys()]).toEqual([11, 12]);
    expect(results.get(Number("11"))!.status).toBe("covered");
  });

  test("without a Unified integration no project is ever confirmed", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj()] }), now: NOW });
    const p = ev.get(U1)!;
    expect(p.meta.unifiedAvailable).toBe(false);
    const r = evaluateFromEvidence(p, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.verifiedHours).toBe(0);
    expect(r.status).toBe("unverified");
  });

  test("with an injected verifier the same player is covered", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj()] }), verifier: confirming, now: NOW });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.status).toBe("covered");
  });

  test("a verifier that throws degrades to unverified", async () => {
    const broken: UnifiedVerifier = { available: true, verify: async () => { throw new Error("down"); } };
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj()] }), verifier: broken, now: NOW });
    expect(ev.get(U1)!.meta.unifiedAvailable).toBe(false);
  });

  test("a missing ledger table is tolerated (migration not applied yet)", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj()], ledger: "missing" }), now: NOW });
    expect(ev.get(U1)!.meta.commitmentsKnown).toBe(true);
  });

  test("a failing ledger query makes commitments unknown", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj()], ledger: "error" }), verifier: confirming, now: NOW });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.status).toBe("unverified");
    expect(r.reasons.some((x) => x.code === "commitments_unknown")).toBe(true);
  });

  test("a banned project restricts the player", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj({ banned_at: "2026-10-01" })] }), now: NOW });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.status).toBe("restricted");
  });

  test("ledger rows are matched to the right player", async () => {
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false,
      sql: fakeSql({ owned: [proj()], orders: [orderRow({ id: 7, status: "ordered" })], ledger: [{ order_id: 7, amount_cents: 1234 }] }),
      verifier: confirming,
      now: NOW,
    });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.commitments).toEqual([{ orderId: 7, itemName: "Keyboard", status: "ordered", cents: 1234, source: "ledger" }]);
  });
});

const identityLookup = async (ids: string[]) =>
  new Map<string, SubmissionLookup>(ids.map((id) => [id, { kind: "found", info: { submitted: true, unifiedId: id } }]));

describe("read-only Airtable", () => {
  beforeEach(clearAirtableCache);

  test("only issues GETs with two non-PII fields", async () => {
    stubAirtable(() => new Response(JSON.stringify({ records: [{ id: "recCCCCCCCCCCCCCC", fields: { "Automation - Status": SUBMITTED } }] }), { status: 200 }));
    const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recCCCCCCCCCCCCCC" })] }), now: NOW });
    expect(ev.get(U1)!.projects[0]!.airtable).toBe("submitted");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(decodeURIComponent(c.url).replace(/\+/g, " ")).toContain("fields[]=Automation - Status");
      expect(decodeURIComponent(c.url).replace(/\+/g, " ")).toContain("fields[]=Automation - YSWS Record ID");
      expect(c.url).not.toMatch(/Email|Birthday|Address|First%20Name/);
    }
  });

  test("submitted comes from Automation - Status, even with the trigger checkbox absent", async () => {
    stubAirtable(() => new Response(JSON.stringify({ records: [{ id: "recCCCCCCCCCCCCCC", createdTime: "2026-10-01T00:00:00.000Z", fields: { "Automation - Status": SUBMITTED, "Automation - YSWS Record ID": "recpBUYp5RAB3JEaE" } }] }), { status: 200 }));
    const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recCCCCCCCCCCCCCC" })] }), now: NOW });
    expect(ev.get(U1)!.projects[0]!.airtable).toBe("submitted");
  });

  for (const status of ["1.5–Processing", "0–Error – See Notes", "1–Pending Submission", "2-Submitted", undefined]) {
    test(`status ${JSON.stringify(status)} is never submitted, even with the checkbox checked`, async () => {
      const fields: Record<string, unknown> = { "Automation - Submit to Unified YSWS": true };
      if (status !== undefined) fields["Automation - Status"] = status;
      stubAirtable(() => new Response(JSON.stringify({ records: [{ id: "recCCCCCCCCCCCCCC", fields }] }), { status: 200 }));
      const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recCCCCCCCCCCCCCC" })] }), now: NOW });
      expect(ev.get(U1)!.projects[0]!.airtable).toBe("present");
    });
  }

  test("a record absent from the response is missing and requires review", async () => {
    stubAirtable(() => new Response(JSON.stringify({ records: [] }), { status: 200 }));
    const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recDDDDDDDDDDDDDD" })] }), verifier: confirming, now: NOW });
    expect(ev.get(U1)!.projects[0]!.airtable).toBe("missing");
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    expect(r.status).toBe("review_required");
  });

  test("missing credentials mark Airtable unavailable, never submitted", async () => {
    delete process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
    stubAirtable(() => new Response("{}", { status: 200 }));
    const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recEEEEEEEEEEEEEE" })] }), now: NOW });
    expect(calls).toHaveLength(0);
    expect(ev.get(U1)!.projects[0]!.airtable).toBe("unavailable");
    expect(ev.get(U1)!.meta.airtableAvailable).toBe(false);
  });

  test("a network failure marks Airtable unavailable", async () => {
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const ev = await loadPlayerEvidence([U1], { liveAirtable: true, sql: fakeSql({ owned: [proj({ airtable_record_id: "recFFFFFFFFFFFFFF" })] }), now: NOW });
    expect(ev.get(U1)!.meta.airtableAvailable).toBe(false);
  });

  test("list rendering never calls Airtable", async () => {
    stubAirtable(() => new Response("{}", { status: 200 }));
    await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [proj({ airtable_record_id: "recGGGGGGGGGGGGGG" })] }), now: NOW });
    expect(calls).toHaveLength(0);
  });
});

function fakeDb(order: Record<string, unknown> | null, rpc: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }) }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpc(fn, args);
    },
  };
  return { db: db as never, rpcCalls };
}

describe("claim flow", () => {
  const base = { orderId: 100, by: "Fulfiller", bySlack: "UF1" };
  const tables = { owned: [proj({ airtable_record_id: null })], payouts: [payout()] };

  test("revalidates eligibility server-side and passes the evidence to the atomic claim", async () => {
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: true, code: "claimed" }, error: null }));
    const out = await claimOrderWithFunding(base, { db, sql: fakeSql(tables), verifier: confirming });
    expect(out.kind).toBe("claimed");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe("claim_shop_order_with_commitment");
    expect(rpcCalls[0]!.args).toMatchObject({
      p_order_id: 100,
      p_by: "Fulfiller",
      p_by_slack: "UF1",
      p_amount_cents: 1000,
      p_verified_funding_cents: 4000,
      p_verdict: "covered",
      p_policy_version: "2026-10-22.3",
      p_enforce: false,
    });
  });

  test("advisory mode still claims an unverified order and records the verdict", async () => {
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: true, code: "claimed" }, error: null }));
    const out = await claimOrderWithFunding(base, { db, sql: fakeSql(tables) });
    expect(out.kind).toBe("claimed");
    expect(rpcCalls[0]!.args.p_verdict).toBe("unverified");
  });

  test("enforcement refuses what the database refuses", async () => {
    const policy = { ...POLICIES["2026-10-22.1"]!, enforceOnClaim: true };
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: false, code: "insufficient" }, error: null }));
    const out = await claimOrderWithFunding(base, { db, sql: fakeSql(tables), verifier: confirming, policy });
    expect(out).toMatchObject({ kind: "refused", code: "insufficient" });
    expect(rpcCalls[0]!.args.p_enforce).toBe(true);
  });

  test("enforcement refuses outright when evidence cannot be loaded", async () => {
    const policy = { ...POLICIES["2026-10-22.1"]!, enforceOnClaim: true };
    const failing = (() => { throw new Error("db down"); }) as unknown as SqlLike;
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: true, code: "claimed" }, error: null }));
    const out = await claimOrderWithFunding(base, { db, sql: failing, policy });
    expect(out).toMatchObject({ kind: "refused", code: "evidence_unavailable" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("advisory mode still records the claim in the ledger as unverified when evidence cannot be loaded", async () => {
    const failing = (() => { throw new Error("db down"); }) as unknown as SqlLike;
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: true, code: "claimed" }, error: null }));
    const out = await claimOrderWithFunding(base, { db, sql: failing });
    expect(out).toMatchObject({ kind: "claimed", degraded: true, result: null });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.args).toMatchObject({
      p_amount_cents: 1000,
      p_verified_funding_cents: 0,
      p_verdict: "unverified",
      p_enforce: false,
      p_evidence: { degraded: "evidence_unavailable" },
    });
  });

  test("an undeployed ledger is reported as unledgered when the policy allows it", async () => {
    const policy = { ...POLICIES["2026-10-22.2"]!, allowUnledgeredClaim: true };
    const { db } = fakeDb(orderRow(), () => ({ data: null, error: { code: "42883", message: "function does not exist" } }));
    expect(await claimOrderWithFunding(base, { db, sql: fakeSql(tables), policy })).toEqual({ kind: "unledgered", reason: "ledger_not_installed" });
  });

  test("an undeployed ledger is a hard error under every shipped policy", async () => {
    for (const policy of Object.values(POLICIES)) {
      expect(policy.allowUnledgeredClaim).toBe(false);
      const { db } = fakeDb(orderRow(), () => ({ data: null, error: { code: "42883", message: "function does not exist" } }));
      await expect(claimOrderWithFunding(base, { db, sql: fakeSql(tables), policy })).rejects.toThrow("migration 0229");
    }
  });

  test("permission errors are thrown even when unledgered claims are allowed", async () => {
    const policy = { ...POLICIES["2026-10-22.2"]!, allowUnledgeredClaim: true };
    const { db } = fakeDb(orderRow(), () => ({ data: null, error: { code: "42501", message: "permission denied for function" } }));
    await expect(claimOrderWithFunding(base, { db, sql: fakeSql(tables), policy })).rejects.toThrow("permission denied");
  });

  test("a failed order lookup is an error, not a missing order", async () => {
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "connection lost" } }) }) }) }),
      rpc: async () => ({ data: null, error: null }),
    } as never;
    await expect(claimOrderWithFunding(base, { db, sql: fakeSql(tables) })).rejects.toThrow("connection lost");
  });

  test("other database errors are thrown, not swallowed", async () => {
    const { db } = fakeDb(orderRow(), () => ({ data: null, error: { code: "XX000", message: "kaboom" } }));
    await expect(claimOrderWithFunding(base, { db, sql: fakeSql(tables) })).rejects.toThrow("kaboom");
  });

  test("refresh reports each outcome explicitly", async () => {
    const mk = (res: { data: unknown; error: unknown }, row = orderRow({ actual_cost_usd: 8 })) => fakeDb(row, () => res).db;
    expect(await refreshCommitmentAmount(100, { db: mk({ data: true, error: null }), sql: fakeSql(tables) })).toBe("refreshed");
    expect(await refreshCommitmentAmount(100, { db: mk({ data: false, error: null }), sql: fakeSql(tables) })).toBe("no_ledger_row");
    expect(await refreshCommitmentAmount(100, { db: mk({ data: null, error: { code: "42883", message: "x" } }), sql: fakeSql(tables) })).toBe("ledger_not_installed");
    expect(await refreshCommitmentAmount(100, { db: mk({ data: null, error: { code: "XX000", message: "x" } }), sql: fakeSql(tables) })).toBe("failed");
    expect(await refreshCommitmentAmount(100, { db: fakeDb(null, () => ({ data: null, error: null })).db })).toBe("failed");
  });

  test("refresh keeps a project funding grant at its approved face value", async () => {
    const grant = orderRow({ id: 100, item_name: "Hardware funding grant , Proj", price: 150, status: "ordered", actual_cost_usd: 17 });
    const { db, rpcCalls } = fakeDb(grant, () => ({ data: true, error: null }));
    const t = { owned: [proj({ funding_usd: "20", needs_funding: true, funding_deducted_px: 150 })], orders: [grant] };
    await refreshCommitmentAmount(100, { db, sql: fakeSql(t) });
    expect(rpcCalls[0]!.args).toMatchObject({ p_amount_cents: 2000, p_basis: "face" });
  });

  test("refresh sends the recomputed amount for the real cost", async () => {
    const { db, rpcCalls } = fakeDb(orderRow({ actual_cost_usd: 8 }), () => ({ data: true, error: null }));
    await refreshCommitmentAmount(100, { db, sql: fakeSql(tables) });
    expect(rpcCalls[0]).toMatchObject({ fn: "refresh_fulfillment_commitment", args: { p_order_id: 100, p_amount_cents: 800, p_basis: "actual" } });
  });

  test("a lost race is reported as not pending", async () => {
    const { db } = fakeDb(orderRow(), () => ({ data: { ok: false, code: "not_pending" }, error: null }));
    expect(await claimOrderWithFunding(base, { db, sql: fakeSql(tables) })).toMatchObject({ kind: "refused", code: "not_pending" });
  });

  test("a missing order is refused", async () => {
    const { db, rpcCalls } = fakeDb(null, () => ({ data: null, error: null }));
    expect(await claimOrderWithFunding(base, { db, sql: fakeSql(tables) })).toMatchObject({ kind: "refused", code: "not_found" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("legacy derived commitments are passed to the lock-time cap check", async () => {
    const { db, rpcCalls } = fakeDb(orderRow(), () => ({ data: { ok: true, code: "claimed" }, error: null }));
    await claimOrderWithFunding(base, {
      db,
      verifier: confirming,
      sql: fakeSql({ ...tables, owned: [proj({ airtable_record_id: null, funding_usd: "5", needs_funding: true, funding_deducted_px: 50 })], orders: [orderRow({ id: 7, status: "done", price: 100 }), orderRow({ id: 8, status: "ordered", price: 50 })], ledger: [{ order_id: 8, amount_cents: 500 }] }),
    });
    expect(rpcCalls[0]!.args.p_other_committed_cents).toBe(1000 + 500);
  });

  test("the evidence snapshot carries no personal data", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql(tables), verifier: confirming, now: NOW });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow() as never), POLICIES["2026-10-22.1"], NOW);
    const text = JSON.stringify(evidenceSnapshot(r));
    expect(text).not.toMatch(/@|address|email|birthday|github\.com/i);
    expect(text).not.toContain('"name":"Proj"');
    expect(claimRpcArgs(r, { ...base, enforce: false }).p_evidence).toEqual(evidenceSnapshot(r));
  });
});

const root = join(import.meta.dir, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("authorization and existing actions", () => {
  const actions = read("app/actions.ts");

  test("claiming still requires the fulfiller role server-side", () => {
    expect(actions).toContain('export const claimOrder = guardedAction("claimOrder", "fulfiller"');
    expect(actions).toContain('export const cancelOrder = guardedAction("cancelOrder", "owner"');
  });

  test("the fulfillment page still gates on the fulfiller role", () => {
    expect(read("app/fulfillment/page.tsx")).toContain('requirePage("fulfiller")');
  });

  test("claimOrder keeps self-dealing protection, notification and audit logging", () => {
    const body = actions.slice(actions.indexOf("export const claimOrder"), actions.indexOf("export const flagOrderOverBudget"));
    expect(body).toContain("isOwnOrder");
    expect(body).toContain('"order_claimed"');
    expect(body).toContain('title: "Order placed!');
    expect(body).toContain("claimOrderWithFunding");
  });

  test("markOrderCredited still requires an HCB link and refreshes the commitment amount", () => {
    const body = actions.slice(actions.indexOf("export const markOrderCredited"), actions.indexOf("export const shipOrder"));
    expect(body).toContain("!hcbLink");
    expect(body).toContain("isSafeUrl(hcbLink)");
    expect(body).toContain("refreshCommitmentAmount");
  });

  test("the eligibility modules export no server actions and never mutate Airtable", () => {
    const dir = join(root, "lib/eligibility");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toContain('"use server"');
      expect(src).not.toMatch(/pushProjectRecord|deleteAirtableRecords|buildAirtableFields/);
      expect(src).not.toMatch(/method:\s*"(POST|PATCH|PUT|DELETE)"/);
    }
  });

  test("the Airtable read helper issues GET only", () => {
    const src = read("lib/airtable.ts");
    const fn = src.slice(src.indexOf("async function lookupChunk"), src.indexOf("// Creates a new record"));
    expect(fn).toContain('method: "GET"');
    expect(fn).not.toMatch(/PATCH|POST|DELETE/);
  });

  test("no action ever auto-approves, buys, sends a grant or cancels from the eligibility code", () => {
    const dir = join(root, "lib/eligibility");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/cancel_shop_order|cancel_claimed_shop_order|markOrderCredited|shipOrder|markOrderDone/);
    }
  });
});

describe("Ships in the evidence loader", () => {
  const rowsFor = (over: Record<string, unknown> = {}) => [
    { id: REC_A, ysws: "Pixl", approved_at: Math.floor(NOW / 1000) - 86400, code_url: "https://github.com/a/b", github_username: "a", hours: 10, slack_id: "null", ...over },
  ];
  const viewOf = (rows: unknown[]) => {
    const snapshot = buildSnapshot(rows, NOW - 60_000);
    return { snapshot, fetchedAt: snapshot.fetchedAt, ageMs: 60_000, fresh: true, error: null, lastAttemptAt: NOW, nextRetryAt: null };
  };
  const tables = (extra: Tables = {}): Tables => ({ owned: [proj()], users: [{ id: U1, slack_id: "UPLAYER001" }], ...extra });

  test("a matching record verifies the project and covers an affordable order", async () => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, airtable: identityLookup, sql: fakeSql(tables()), now: NOW, ships: viewOf(rowsFor()) });
    const p = ev.get(U1)!;
    expect(p.projects[0]!.ships!.state).toBe("approved");
    expect(p.meta.shipsAvailable).toBe(true);
    expect(p.meta.unifiedAvailable).toBe(true);
    const r = evaluateFromEvidence(p, toOrderInput(orderRow({ price: 100 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.status).toBe("covered");
    expect(r.verifiedHours).toBe(10);
  });

  test("a Slack id on the Ships row that is not the player's is flagged", async () => {
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false, airtable: identityLookup,
      sql: fakeSql(tables()),
      now: NOW,
      ships: viewOf(rowsFor({ slack_id: "UOTHER0001" })),
    });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("identity_mismatch");
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow({ price: 100 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.status).toBe("review_required");
  });

  test("without a Ships source nothing can be covered and no request is made", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      return new Response("[]");
    }) as typeof fetch;
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, airtable: identityLookup, sql: fakeSql(tables()), now: NOW });
    expect(fetched).toBe(0);
    expect(ev.get(U1)!.meta.shipsAvailable).toBe(false);
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow({ price: 100 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.status).not.toBe("covered");
  });

  test("a whole queue of orders reuses a single Ships snapshot", async () => {
    let gets = 0;
    const view = viewOf(rowsFor());
    const provider = {
      get: async () => {
        gets++;
        return view;
      },
    } as unknown as ShipsProvider;
    const orders = Array.from({ length: 40 }, (_, i) => orderRow({ id: 500 + i, price: 10 }));
    const results = await evaluateOrders(orders as never[], { liveAirtable: false, airtable: identityLookup, sql: fakeSql(tables()), ships: provider });
    expect(gets).toBe(1);
    expect(results.size).toBe(40);
  });

  test("a collaborator project is matched through their own record id", async () => {
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false, airtable: identityLookup,
      sql: fakeSql({
        users: [{ id: U1, slack_id: "UPLAYER001" }],
        collab: [{ id: 2, name: "Shared", status: "approved", banned_at: null, repo_url: "https://github.com/c/d", system_note: "", funding_usd: 0, hours_deflated_at: null, collab_user_id: U1, collab_hours: "6", collab_record_id: REC_B, collab_prior_hours: 0 }],
      }),
      now: NOW,
      ships: viewOf(rowsFor({ id: REC_B, code_url: "https://github.com/c/d", hours: 6, slack_id: "UPLAYER001" })),
    });
    const line = ev.get(U1)!.projects[0]!;
    expect(line.role).toBe("collaborator");
    expect(line.ships!.state).toBe("approved");
    expect(line.ships!.recordId).toBe(REC_B);
  });
});

describe("first submission, update and re-ship hours", () => {
  const REC_NEW = "recNEWNEWNEWNEW00";
  const ships = (rows: Record<string, unknown>[]) => {
    const snapshot = buildSnapshot(
      rows.map((r) => ({ ysws: "Pixl", approved_at: Math.floor(NOW / 1000) - 86400, code_url: "https://github.com/a/b", github_username: "a", slack_id: "null", ...r })),
      NOW - 60_000,
    );
    return { snapshot, fetchedAt: snapshot.fetchedAt, ageMs: 60_000, fresh: true, error: null, lastAttemptAt: NOW, nextRetryAt: null };
  };
  const evalWith = async (p: Record<string, unknown>, rows: Record<string, unknown>[], priceUsd = 1) => {
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, airtable: identityLookup, sql: fakeSql({ owned: [proj(p)] }), now: NOW, ships: ships(rows) });
    return evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow({ price: priceUsd * 10 }) as never), POLICIES["2026-10-22.2"], NOW);
  };

  test("first submission: Ships hours equal approved hours, nothing is subtracted", async () => {
    const r = await evalWith({ approved_hours: "10", prior_approved_hours: 0 }, [{ id: REC_A, hours: 10 }]);
    expect(r.verifiedHours).toBe(10);
    expect(r.provisionalHours).toBe(0);
    expect(r.projects[0]!.discrepancy).toBe("none");
  });

  test("update in review: the earlier approval still counts, as unverified, and is not dropped", async () => {
    const r = await evalWith(
      { status: "shipped", approved_hours: "87", prior_approved_hours: "87", airtable_record_id: null },
      [{ id: REC_A, hours: 87 }],
    );
    expect(r.projects[0]!.counted).not.toBe("excluded");
    expect(r.verifiedHours + r.provisionalHours).toBe(87);
  });

  test("update approved: the new row holds only the delta, prior hours are counted once", async () => {
    const r = await evalWith(
      { approved_hours: "90", prior_approved_hours: "87", airtable_record_id: REC_NEW },
      [{ id: REC_NEW, hours: 3 }, { id: REC_A, hours: 87 }],
    );
    expect(r.verifiedHours).toBe(3);
    expect(r.provisionalHours).toBe(87);
    expect(r.verifiedHours + r.provisionalHours).toBe(90);
    expect(r.projects[0]!.discrepancy).toBe("none");
  });

  test("re-ship after needs_changes: baseline while pending, then delta once approved", async () => {
    const pending = await evalWith(
      { status: "needs_changes", approved_hours: "87", prior_approved_hours: "87", airtable_record_id: null },
      [],
    );
    expect(pending.verifiedHours + pending.provisionalHours).toBe(87);
    const approved = await evalWith(
      { approved_hours: "95", prior_approved_hours: "87", airtable_record_id: REC_NEW },
      [{ id: REC_NEW, hours: 8 }],
    );
    expect(approved.verifiedHours).toBe(8);
    expect(approved.verifiedHours + approved.provisionalHours).toBe(95);
  });

  test("a Ships row carrying the cumulative total is capped at the delta, never added on top", async () => {
    const r = await evalWith(
      { approved_hours: "90", prior_approved_hours: "87", airtable_record_id: REC_NEW },
      [{ id: REC_NEW, hours: 90 }],
    );
    expect(r.verifiedHours).toBe(3);
    expect(r.projects[0]!.discrepancy).toBe("material");
    expect(r.verifiedHours + r.provisionalHours).toBe(90);
  });

  test("a rejected update with a frozen baseline is not counted", async () => {
    const r = await evalWith({ status: "rejected", approved_hours: "87", prior_approved_hours: "87", airtable_record_id: null }, []);
    expect(r.projects[0]!.counted).toBe("excluded");
  });

  test("a collaborator's update uses their own baseline", async () => {
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false, airtable: identityLookup,
      sql: fakeSql({
        collab: [{ id: 2, name: "Shared", status: "shipped", banned_at: null, repo_url: "https://github.com/c/d", system_note: "", funding_usd: 0, hours_deflated_at: null, collab_user_id: U1, collab_hours: "20", collab_record_id: null, collab_prior_hours: "20" }],
      }),
      now: NOW,
      ships: ships([]),
    });
    const p = ev.get(U1)!.projects[0]!;
    expect(p.status).toBe("approved");
    expect(p.approvedHours).toBe(20);
  });
});

describe("staging to Unified record mapping", () => {
  beforeEach(clearAirtableCache);
  const STAGING = "recVBJwAiV440SX4V";
  const UNIFIED = "recpBUYp5RAB3JEaE";
  const SIBLING = "recwFAtNLs7sscrtE";
  const REPO = "https://github.com/polarnl/polarlearn-v2";
  const lookupOf = (m: Record<string, SubmissionLookup>) => async (ids: string[]) =>
    new Map<string, SubmissionLookup>(ids.map((id) => [id, m[id] ?? { kind: "missing" }]));
  const found = (unifiedId: string | null): SubmissionLookup => ({ kind: "found", info: { submitted: true, unifiedId } });
  const viewOf = (rows: Record<string, unknown>[]) => {
    const snapshot = buildSnapshot(
      rows.map((r) => ({ ysws: "Pixl", approved_at: Math.floor(NOW / 1000) - 86400, code_url: REPO, github_username: "polarnl", slack_id: "null", ...r })),
      NOW - 60_000,
    );
    return { snapshot, fetchedAt: snapshot.fetchedAt, ageMs: 60_000, fresh: true, error: null, lastAttemptAt: NOW, nextRetryAt: null };
  };
  const ships = viewOf([
    { id: UNIFIED, hours: 87 },
    { id: SIBLING, hours: 3 },
  ]);
  const andrei = (over: Record<string, unknown> = {}) => proj({ id: 1406, name: "PolarLearn V2", approved_hours: "87", repo_url: REPO, airtable_record_id: STAGING, ...over });
  const load = (owned: Record<string, unknown>[], lookup: Record<string, SubmissionLookup>, extra: Partial<Tables> = {}) =>
    loadPlayerEvidence([U1], { liveAirtable: false, airtable: lookupOf(lookup), sql: fakeSql({ owned, users: [{ id: U1, slack_id: "UANDREI001" }], ...extra }), now: NOW, ships });

  test("Andrei's staging id is not in Ships, but its mapped Unified id is and resolves to the 87h record", async () => {
    expect(ships.snapshot.byId.has(STAGING)).toBe(false);
    const ev = await load([andrei()], { [STAGING]: found(UNIFIED) });
    const s = ev.get(U1)!.projects[0]!.ships!;
    expect(s.state).toBe("approved");
    expect(s.recordId).toBe(UNIFIED);
    expect(s.hours).toBe(87);
  });

  test("a collaborator's own staging record maps to their own 3h Unified record on the same repository", async () => {
    const ev = await load(
      [andrei()],
      { [STAGING]: found(UNIFIED), recCOLLAB0000000A: found(SIBLING) },
      {
        collab: [{ id: 2, name: "PolarLearn V2", status: "approved", banned_at: null, repo_url: REPO, system_note: "", funding_usd: 0, hours_deflated_at: null, collab_user_id: U1, collab_hours: "3", collab_record_id: "recCOLLAB0000000A", collab_prior_hours: 0 }],
      },
    );
    const lines = ev.get(U1)!.projects;
    const owner = lines.find((l) => l.role === "owner")!;
    expect(owner.ships!.recordId).toBe(UNIFIED);
    expect(owner.ships!.hours).toBe(87);
  });

  test("repository and hours alone never verify when the mapping is empty", async () => {
    const ev = await load([andrei()], { [STAGING]: found(null) });
    const p = ev.get(U1)!;
    expect(p.projects[0]!.ships!.state).toBe("no_record");
    const r = evaluateFromEvidence(p, toOrderInput(orderRow({ price: 10 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.status).not.toBe("covered");
    expect(r.verifiedHours).toBe(0);
  });

  test("a missing staging record is not matched to Ships", async () => {
    const ev = await load([andrei()], { [STAGING]: { kind: "missing" } });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("no_record");
  });

  test("an unreachable Airtable shows Unverified, never Covered", async () => {
    const ev = await load([andrei()], { [STAGING]: { kind: "error", error: "offline" } });
    const p = ev.get(U1)!;
    expect(p.projects[0]!.ships!.state).toBe("unavailable");
    expect(p.meta.airtableAvailable).toBe(false);
    const r = evaluateFromEvidence(p, toOrderInput(orderRow({ price: 10 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.status).not.toBe("covered");
  });

  test("an uncached list render cannot map, so it never claims Covered", async () => {
    clearAirtableCache();
    const ev = await loadPlayerEvidence([U1], { liveAirtable: false, sql: fakeSql({ owned: [andrei()], users: [{ id: U1, slack_id: "UANDREI001" }] }), now: NOW, ships });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("unavailable");
  });

  test("two projects mapping to one Unified record are both ambiguous", async () => {
    const ev = await load([andrei(), andrei({ id: 1407, airtable_record_id: "recSTAGING2222222" })], {
      [STAGING]: found(UNIFIED),
      recSTAGING2222222: found(UNIFIED),
    });
    for (const l of ev.get(U1)!.projects) expect(l.ships!.state).toBe("ambiguous");
  });

  test("a mapped record on a different repository is an identity mismatch", async () => {
    const ev = await load([andrei({ repo_url: "https://github.com/other/thing" })], { [STAGING]: found(UNIFIED) });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("identity_mismatch");
  });

  test("a mapped Unified id absent from Ships is not_found", async () => {
    const ev = await load([andrei()], { [STAGING]: found("recNOTINSHIPS0000") });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("not_found");
  });

  test("a project with no staging id still matches only by repository and Slack id", async () => {
    const ev = await load([andrei({ airtable_record_id: null })], {});
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("ambiguous");
  });

  test("the live Airtable response shape (plain string field) maps Andrei's staging record to the 87h Unified record", async () => {
    stubAirtable(
      () =>
        new Response(
          JSON.stringify({
            records: [
              { id: STAGING, createdTime: "2026-10-01T00:00:00.000Z", fields: { "Automation - Status": SUBMITTED, "Automation - YSWS Record ID": UNIFIED } },
            ],
          }),
          { status: 200 },
        ),
    );
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: true,
      sql: fakeSql({ owned: [andrei()], users: [{ id: U1, slack_id: "UANDREI001" }] }),
      now: NOW,
      ships,
    });
    const p = ev.get(U1)!.projects[0]!;
    expect(p.airtable).toBe("submitted");
    expect(p.ships!.state).toBe("approved");
    expect(p.ships!.recordId).toBe(UNIFIED);
    expect(p.ships!.hours).toBe(87);
    for (const c of calls) expect(c.method).toBe("GET");
  });

  test("Airtable omits the mapping field when it is empty, which stays unmatched", async () => {
    stubAirtable(() => new Response(JSON.stringify({ records: [{ id: STAGING, fields: { "Automation - Status": SUBMITTED } }] }), { status: 200 }));
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: true,
      sql: fakeSql({ owned: [andrei()], users: [{ id: U1, slack_id: "UANDREI001" }] }),
      now: NOW,
      ships,
    });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("no_record");
  });

  test("a non-record-id value in the mapping field is ignored", async () => {
    stubAirtable(() => new Response(JSON.stringify({ records: [{ id: STAGING, fields: { "Automation - YSWS Record ID": "not-a-record" } }] }), { status: 200 }));
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: true,
      sql: fakeSql({ owned: [andrei()], users: [{ id: U1, slack_id: "UANDREI001" }] }),
      now: NOW,
      ships,
    });
    expect(ev.get(U1)!.projects[0]!.ships!.state).toBe("no_record");
  });

  test("Andrei's real spending leaves him $60.09 over, so nothing further is covered", async () => {
    const orders = [
      orderRow({ id: 71, item_name: "Sony WH-1000XM5", quantity: 1, price: 2258, status: "shipped", actual_cost_usd: 218.09 }),
      orderRow({ id: 72, item_name: "10$ Storage grant", quantity: 16, price: 1792, status: "done", actual_cost_usd: 160 }),
      orderRow({ id: 73, item_name: "AI subscription/credits", quantity: 20, price: 2240, status: "cancelled", actual_cost_usd: null }),
      orderRow({ id: 86, item_name: "AI subscription/credits", quantity: 3, price: 336, status: "done", actual_cost_usd: 30 }),
      orderRow({ id: 107, item_name: "Signed Org Photo", quantity: 1, price: 85, status: "pending", actual_cost_usd: null }),
    ];
    const ev = await load([andrei()], { [STAGING]: found(UNIFIED) }, { orders });
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orders[4] as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.verifiedFundingCents).toBe(34800);
    expect(r.committedCents).toBe(40809);
    expect(r.remainingCents).toBe(-6009);
    expect(r.status).toBe("insufficient");
  });
});

describe("payout history in the evidence loader", () => {
  const load = (payouts: Record<string, unknown>[] | "error", extra: Partial<Tables> = {}) =>
    loadPlayerEvidence([U1], {
      liveAirtable: false,
      airtable: identityLookup,
      sql: fakeSql({ owned: [proj({ approved_hours: "87" })], payouts: payouts === "error" ? [] : payouts, ...extra }),
      now: NOW,
    });

  test("approval and reversal rows are summed and the hours come from the latest approval row", async () => {
    const ev = await load([
      payout({ id: 1, amount: 6399, hours: 115.5 }),
      payout({ id: 2, amount: -1910, hours: 87 }),
    ]);
    expect(ev.get(U1)!.projects[0]!.payout).toEqual({ netPx: 4489, creditedHours: 87, rows: 2, withheldPx: 0, trialPrizePx: 0 });
  });

  test("a review reversal is subtracted but does not change the credited hours", async () => {
    const ev = await load([payout({ id: 1, amount: 400, hours: 10 }), payout({ id: 2, amount: -100, hours: 0, reason: "review_reverted" })]);
    expect(ev.get(U1)!.projects[0]!.payout).toMatchObject({ netPx: 300, creditedHours: 10, rows: 1 });
  });

  test("other pixel reasons are not part of project funding", async () => {
    const ev = await load([payout({ id: 1, amount: 400, hours: 10 })]);
    expect(ev.get(U1)!.projects[0]!.payout!.netPx).toBe(400);
  });

  test("a project with no payout rows has no history", async () => {
    const ev = await load([payout({ id: 1, project_id: 999 })]);
    expect(ev.get(U1)!.projects[0]!.payout).toBeNull();
  });

  test("withheld hardware funding is carried for the owner only when the grant applies", async () => {
    const ev = await load([payout()], { owned: [proj({ approved_hours: "10", needs_funding: true, funding_deducted_px: 80 })] });
    expect(ev.get(U1)!.projects[0]!.payout!.withheldPx).toBe(80);
    const none = await load([payout()], { owned: [proj({ approved_hours: "10", needs_funding: false, funding_deducted_px: 80 })] });
    expect(none.get(U1)!.projects[0]!.payout!.withheldPx).toBe(0);
  });

  test("a kept Trial prize is carried for the owner, and not for pixel opt-outs or zero prizes", async () => {
    const trial = { approved_hours: "6", trial_reward_choice: "item", trial_prize_px: 121, trial_prize_order_id: 88 };
    const kept = await load([payout()], { owned: [proj(trial)] });
    expect(kept.get(U1)!.projects[0]!.payout!.trialPrizePx).toBe(121);
    const pixels = await load([payout()], { owned: [proj({ ...trial, trial_reward_choice: "pixels", trial_prize_order_id: null })] });
    expect(pixels.get(U1)!.projects[0]!.payout!.trialPrizePx).toBe(0);
    const zero = await load([payout()], { owned: [proj({ ...trial, trial_prize_px: 0 })] });
    expect(zero.get(U1)!.projects[0]!.payout!.trialPrizePx).toBe(0);
    const noOrder = await load([payout()], { owned: [proj({ ...trial, trial_prize_order_id: null })] });
    expect(noOrder.get(U1)!.projects[0]!.payout!.trialPrizePx).toBe(0);
  });

  describe("an all-prize Trial with no payout transaction", () => {
    const allPrize = { approved_hours: "3", trial_reward_choice: "item", trial_held_px: 121, trial_prize_px: 121, trial_prize_order_id: 88 };
    const prizeOrder = { id: 88, user_id: U1, item_name: "Pixl Sticker Sheet", quantity: 1, price: 121, status: "pending", actual_cost_usd: null, flagged_at: null };

    test("funds the held prize from the approved hours when the prize order is the player's own", async () => {
      const ev = await load([], { owned: [proj(allPrize)], orders: [prizeOrder] });
      expect(ev.get(U1)!.projects[0]!.payout).toEqual({ netPx: 0, withheldPx: 0, trialPrizePx: 121, creditedHours: 3, rows: 1 });
    });

    test("stays unestablished when the held amount is more than the prize", async () => {
      const ev = await load([], { owned: [proj({ ...allPrize, trial_held_px: 242 })], orders: [prizeOrder] });
      expect(ev.get(U1)!.projects[0]!.payout).toBeNull();
    });

    test("stays unestablished when the prize order is not the owner's", async () => {
      const ev = await load([], { owned: [proj(allPrize)], orders: [{ ...prizeOrder, user_id: "someone-else" }] });
      expect(ev.get(U1)!.projects[0]!.payout).toBeNull();
    });

    test("stays unestablished for a pixel opt-out, an unapproved or banned project, or a reversed approval", async () => {
      const opt = await load([], { owned: [proj({ ...allPrize, trial_reward_choice: "pixels" })], orders: [prizeOrder] });
      expect(opt.get(U1)!.projects[0]!.payout).toBeNull();
      const draft = await load([], { owned: [proj({ ...allPrize, status: "draft" })], orders: [prizeOrder] });
      expect(draft.get(U1)!.projects[0]!.payout).toBeNull();
      const banned = await load([], { owned: [proj({ ...allPrize, banned_at: "2026-10-20T00:00:00Z" })], orders: [prizeOrder] });
      expect(banned.get(U1)!.projects[0]!.payout).toBeNull();
      const reverted = await load([payout({ amount: -5, reason: "review_reverted" })], { owned: [proj(allPrize)], orders: [prizeOrder] });
      expect(reverted.get(U1)!.projects[0]!.payout!.rows).toBe(0);
    });
  });

  test("the old flat policies ignore payout rows", async () => {
    const ev = await load([payout({ amount: 999, hours: 10 })]);
    const r = evaluateFromEvidence(ev.get(U1)!, toOrderInput(orderRow({ price: 10 }) as never), POLICIES["2026-10-22.2"], NOW);
    expect(r.fundingBasis).toBe("flat_rate");
    expect(r.rateUsd).toBe(4);
  });
});

describe("reviewer earnings in fulfillment eligibility", () => {
  const PAYOUT = POLICIES["2026-10-22.3"]!;
  const loadReviewer = (
    reviewerTransactions: Tables["reviewerTransactions"] = [],
    extra: Partial<Tables> = {},
    userIds = [U1],
    verifier?: UnifiedVerifier,
  ) => loadPlayerEvidence(userIds, {
    liveAirtable: false,
    ...(verifier ? { verifier } : {}),
    sql: fakeSql({
      ...extra,
      users: extra.users ?? userIds.map((id) => ({ id, slack_id: `slack-${id}` })),
      reviewPayouts: extra.reviewPayouts ?? [],
      reviewerTransactions,
    }),
    now: NOW,
  });
  const evaluateReviewer = (
    evidence: Awaited<ReturnType<typeof loadReviewer>>,
    userId = U1,
    row: Record<string, unknown> = orderRow({ price: 200 }),
  ) => evaluateFromEvidence(evidence.get(userId)!, toOrderInput(row as never), PAYOUT, NOW);

  test("a reviewer with no Ships projects is covered by actual credited wallet pixels", async () => {
    const ev = await loadReviewer([reviewerTransaction({ amount: 400 })]);
    const r = evaluateReviewer(ev);

    expect(r.status).toBe("covered");
    expect(r.verifiedHours).toBe(0);
    expect(r.projectVerifiedFundingCents).toBe(0);
    expect(r.reviewerEarnings).toMatchObject({ creditedPixels: 400, correctionPixels: 0, netPixels: 400, verifiedPixels: 400, fundingCents: 4000, state: "verified" });
    expect(r.verifiedFundingCents).toBe(4000);
    expect(evidenceSnapshot(r)).toMatchObject({
      projectVerifiedFundingCents: 0,
      reviewerEarnings: { creditedPixels: 400, correctionPixels: 0, verifiedPixels: 400, fundingCents: 4000 },
      verifiedFundingCents: 4000,
    });
    expect(r.ships.available).toBe(false);
  });

  test("verified project and reviewer sources combine without changing the project cap", async () => {
    const ev = await loadReviewer(
      [reviewerTransaction({ amount: 150 })],
      { owned: [proj({ approved_hours: "5" })], payouts: [payout({ amount: 300, hours: 5 })] },
      [U1],
      confirming,
    );
    const r = evaluateReviewer(ev, U1, orderRow({ price: 400 }));

    expect(r.status).toBe("covered");
    expect(r.projectVerifiedFundingCents).toBe(3000);
    expect(r.reviewerEarnings.fundingCents).toBe(1500);
    expect(r.verifiedFundingCents).toBe(4500);
  });

  test("reviewer voids and cuts reduce the net ledger funding", async () => {
    const ev = await loadReviewer([
      reviewerTransaction({ amount: 300 }),
      reviewerTransaction({ id: "9002", amount: -100, reason: "review_payout_voided" }),
      reviewerTransaction({ id: "9003", amount: -100, reason: "review_payout_cut" }),
    ], {
      reviewPayouts: [
        { id: 1, reviewer_slack_id: `slack-${U1}`, status: "paid", full_pixels: 100, paid_pixels: 100, credited: true },
        { id: 2, reviewer_slack_id: `slack-${U1}`, status: "voided", full_pixels: 100, paid_pixels: 0, credited: true },
      ],
    });
    const r = evaluateReviewer(ev, U1, orderRow({ price: 150 }));

    expect(r.reviewerEarnings).toMatchObject({ creditedPixels: 300, correctionPixels: -200, netPixels: 100, verifiedPixels: 100, fundingCents: 1000, state: "verified" });
    expect(r.verifiedFundingCents).toBe(1000);
    expect(r.status).toBe("insufficient");
  });

  test("pending or uncredited payout records without wallet transactions do not count", async () => {
    const queries: string[] = [];
    const payoutRows = [
      { id: 1, reviewer_slack_id: `slack-${U1}`, status: "pending", full_pixels: 300, paid_pixels: 0, credited: false },
      { id: 2, reviewer_slack_id: `slack-${U1}`, status: "paid", full_pixels: 300, paid_pixels: 300, credited: false },
      { id: 3, reviewer_slack_id: `slack-${U1}`, status: "paid", full_pixels: 300, paid_pixels: 300, credited: true },
    ];
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false,
      sql: fakeSql({
        users: [{ id: U1, slack_id: `slack-${U1}` }],
        reviewPayouts: payoutRows,
        reviewerTransactions: [],
      }, queries),
      now: NOW,
    });
    const r = evaluateReviewer(ev);

    expect(r.reviewerEarnings.verifiedPixels).toBe(0);
    expect(r.verifiedFundingCents).toBe(0);
    expect(r.status).not.toBe("covered");
    expect(queries.some((query) => query.includes("from review_payouts"))).toBe(true);
  });

  test("a historical backfill is counted once even when settlement rows also exist", async () => {
    const queries: string[] = [];
    const ev = await loadPlayerEvidence([U1], {
      liveAirtable: false,
      sql: fakeSql({
        reviewerTransactions: [reviewerTransaction({ id: "9004", amount: 300, reason: "review_payout_backfill" })],
        users: [{ id: U1, slack_id: `slack-${U1}` }],
        reviewPayouts: [
          { id: 4, reviewer_slack_id: `slack-${U1}`, status: "paid", full_pixels: 300, paid_pixels: 300, credited: true },
          { id: 5, reviewer_slack_id: `slack-${U1}`, status: "paid", full_pixels: 300, paid_pixels: 300, credited: true },
        ],
      }, queries),
      now: NOW,
    });
    const r = evaluateReviewer(ev);

    expect(r.reviewerEarnings.creditedPixels).toBe(300);
    expect(r.reviewerEarnings.rows).toBe(1);
    expect(r.verifiedFundingCents).toBe(3000);
    expect(queries.some((query) => query.includes("from review_payouts"))).toBe(true);
  });

  test("a repeated transaction id is counted only once", async () => {
    const tx = reviewerTransaction({ amount: 300 });
    const ev = await loadReviewer([tx, { ...tx }]);
    const r = evaluateReviewer(ev);

    expect(r.reviewerEarnings).toMatchObject({ creditedPixels: 300, rows: 1, verifiedPixels: 300 });
    expect(r.verifiedFundingCents).toBe(3000);
  });

  test("previous fulfillment commitments consume reviewer funding", async () => {
    const ev = await loadReviewer([reviewerTransaction({ amount: 300 })], {
      orders: [orderRow({ id: 10, price: 250, status: "done" })],
    });
    const r = evaluateReviewer(ev, U1, orderRow({ id: 11, price: 100 }));

    expect(r.verifiedFundingCents).toBe(3000);
    expect(r.committedCents).toBe(2500);
    expect(r.remainingCents).toBe(500);
    expect(r.status).toBe("insufficient");
  });

  test("reviewer-only eligibility remains covered when Ships cannot be read", async () => {
    const ev = await loadReviewer([reviewerTransaction({ amount: 400 })]);
    const r = evaluateReviewer(ev);

    expect(r.status).toBe("covered");
    expect(r.ships.available).toBe(false);
    expect(r.projects).toHaveLength(0);
  });

  test("unverified project work contributes zero verified funding when reviewer pixels cover the order", async () => {
    const ev = await loadReviewer([reviewerTransaction({ amount: 500 })], {
      owned: [proj({ approved_hours: "30" })],
    });
    const r = evaluateReviewer(ev, U1, orderRow({ price: 200 }));

    expect(r.status).toBe("covered");
    expect(r.projectVerifiedFundingCents).toBe(0);
    expect(r.unverifiedProjectFundingCents).toBeGreaterThan(0);
    expect(r.reviewerEarnings.fundingCents).toBe(5000);
    expect(r.verifiedFundingCents).toBe(5000);
  });

  test("reviewer ledger failures and inconsistent rows fail closed", async () => {
    const failed = await loadReviewer("error");
    const unavailable = evaluateReviewer(failed);
    expect(unavailable.reviewerEarnings.state).toBe("unavailable");
    expect(unavailable.verifiedFundingCents).toBe(0);
    expect(unavailable.status).not.toBe("covered");

    const inconsistent = await loadReviewer([
      reviewerTransaction({ amount: 300 }),
      reviewerTransaction({ id: "9005", amount: 200, reason: "review_payout_voided" }),
    ]);
    const invalid = evaluateReviewer(inconsistent);
    expect(invalid.reviewerEarnings.state).toBe("inconsistent");
    expect(invalid.reviewerEarnings.verifiedPixels).toBe(0);
    expect(invalid.verifiedFundingCents).toBe(0);
    expect(invalid.status).toBe("review_required");

    const reconciliationFailed = await loadReviewer([reviewerTransaction({ amount: 300 })], { reviewPayouts: "error" });
    const unresolved = evaluateReviewer(reconciliationFailed);
    expect(unresolved.reviewerEarnings.state).toBe("unavailable");
    expect(unresolved.reviewerEarnings.verifiedPixels).toBe(0);
    expect(unresolved.verifiedFundingCents).toBe(0);
    expect(unresolved.status).not.toBe("covered");
  });

  test("a credited payout marked voided without its wallet reversal is not verified", async () => {
    const ev = await loadReviewer([reviewerTransaction({ amount: 300 })], {
      reviewPayouts: [{ id: 9, reviewer_slack_id: `slack-${U1}`, status: "voided", full_pixels: 300, paid_pixels: 0, credited: true }],
    });
    const r = evaluateReviewer(ev);

    expect(r.reviewerEarnings.state).toBe("inconsistent");
    expect(r.reviewerEarnings.verifiedPixels).toBe(0);
    expect(r.verifiedFundingCents).toBe(0);
    expect(r.status).toBe("review_required");
  });

  test("transactions are attributed only to their owning user account", async () => {
    const ev = await loadReviewer([reviewerTransaction({ user_id: U2, amount: 400 })], {}, [U1, U2]);
    const u1 = evaluateReviewer(ev, U1);
    const u2 = evaluateReviewer(ev, U2);

    expect(u1.verifiedFundingCents).toBe(0);
    expect(u1.status).not.toBe("covered");
    expect(u2.verifiedFundingCents).toBe(4000);
    expect(u2.status).toBe("covered");
  });

  test("project-only funding retains its existing payout-history value", async () => {
    const ev = await loadReviewer([], {
      owned: [proj({ approved_hours: "5" })],
      payouts: [payout({ amount: 300, hours: 5 })],
    }, [U1], confirming);
    const r = evaluateReviewer(ev, U1, orderRow({ price: 200 }));

    expect(r.projectVerifiedFundingCents).toBe(3000);
    expect(r.reviewerEarnings.fundingCents).toBe(0);
    expect(r.verifiedFundingCents).toBe(3000);
    expect(r.status).toBe("covered");
  });
});
