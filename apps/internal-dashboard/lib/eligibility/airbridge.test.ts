import { describe, expect, test } from "bun:test";
import { airbridgeLookupUrl, getApprovals, getOtterSlack, parseApproval } from "./airbridgeApi";
import { lookupFromCache, resolveOtterIdentity, viewFromCache } from "./airbridgeCache";
import { matchShips } from "./shipsMatch";

const ID = "recAAAAAAAAAAAAAA";
const OTHER = "recBBBBBBBBBBBBBB";
const NOW = Date.parse("2026-11-01T13:00:00Z");
const approval = (id = ID, hours = 9.8) => ({
  id, fields: {
    "Record ID": id, "Code URL": "https://github.com/Example/Project",
    "Hours Spent": hours, "Approved At": "2026-10-31", "YSWS–Name": ["Pixl"],
  },
});
const row = (over: Record<string, unknown> = {}) => ({
  staging_id: OTHER, mapping_state: "mapped", unified_id: ID,
  unified_state: "approved", code_url: "https://github.com/Example/Project",
  approved_hours: "9.80", approved_at_s: 1793448000, program: "Pixl",
  otter_slack_id: "U0123456789", otter_identity_blocked: false,
  otter_checked_ms: NOW, last_attempt_ms: NOW,
  mapping_checked_ms: NOW, verified_at_ms: NOW,
  error: null, ...over,
});

describe("targeted official Unified approval", () => {
  test("accepts exact IDs, fractional hours and Pixl only", () => {
    expect(parseApproval(approval(), ID).hours).toBe(9.8);
    expect(() => parseApproval(approval(), OTHER)).toThrow();
    expect(() => parseApproval({ ...approval(), fields: { ...approval().fields, "YSWS–Name": ["Live"] } }, ID)).toThrow();
    expect(() => parseApproval(approval(ID, -1), ID)).toThrow();
    expect(() => parseApproval({ ...approval(), fields: { ...approval().fields, "Code URL": "https://evil.test/x" } }, ID)).toThrow();
  });
  test("escapes no user input and builds an exact, bounded Airbridge query", () => {
    const url = new URL(airbridgeLookupUrl([ID, OTHER]));
    const select = JSON.parse(url.searchParams.get("select")!);
    expect(select.maxRecords).toBe(3);
    expect(select.filterByFormula).toContain(ID);
    expect(select.fields).toContain("Hours Spent");
    expect(() => airbridgeLookupUrl([ID, ID])).toThrow();
    expect(() => airbridgeLookupUrl(["not-a-valid-id"])).toThrow();
  });
  test("rejects unexpected IDs or truncated envelopes", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([approval(OTHER)]));
    await expect(getApprovals([ID], fetchImpl)).rejects.toThrow();
    const valid: typeof fetch = async (url) => {
      const formula = JSON.parse(new URL(String(url)).searchParams.get("select")!).filterByFormula as string;
      return new Response(JSON.stringify(formula.includes(ID) ? [approval(ID)] : []));
    };
    const found = await getApprovals([ID, OTHER], valid);
    expect(found.get(ID)?.hours).toBe(9.8);
    expect(found.get(OTHER)).toBeNull();
  });
  test("an omitted bulk record is independently retrieved before declaring removal", async () => {
    const queries: string[] = [];
    const truncated: typeof fetch = async url => {
      const formula = JSON.parse(new URL(String(url)).searchParams.get("select")!).filterByFormula as string;
      queries.push(formula);
      return new Response(JSON.stringify(formula.includes(ID) && formula.includes(OTHER)
        ? [approval(ID)] : formula.includes(OTHER) ? [approval(OTHER)] : [approval(ID)]));
    };
    const found = await getApprovals([ID, OTHER], truncated);
    expect(found.get(OTHER)?.id).toBe(OTHER);
    expect(queries).toHaveLength(2);
  });
  test("single-ID misses require a second confirmation", async () => {
    let calls = 0;
    const flaky: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify(calls === 1 ? [] : [approval(ID)]));
    };
    expect((await getApprovals([ID], flaky)).get(ID)?.hours).toBe(9.8);
    expect(calls).toBe(2);
  });
  test("Otter only supplies identity when it matches the exact Unified record", async () => {
    const candidate = parseApproval(approval(), ID);
    const fake: typeof fetch = async () => new Response(JSON.stringify({ data: [
      { airtable_id: OTHER, code_url: candidate.repoUrl, ysws: "Pixl", slack_id: "U0999999999" },
      { airtable_id: ID, code_url: candidate.repoUrl, ysws: "Pixl", slack_id: "U0123456789" },
    ] }));
    expect(await getOtterSlack(candidate, fake)).toEqual({ state: "verified", slackId: "U0123456789" });
    const invalid: typeof fetch = async () => new Response(JSON.stringify({ data: [
      { airtable_id: ID, code_url: "https://github.com/Evil/repo", ysws: "Pixl", slack_id: "U0123456789" },
    ] }));
    expect(await getOtterSlack(candidate, invalid)).toEqual({ state: "not_found" });
    const outage: typeof fetch = async () => new Response("down", { status: 503 });
    expect(await getOtterSlack(candidate, outage)).toEqual({ state: "unavailable" });
    const malformed: typeof fetch = async () => new Response(JSON.stringify({ broken: [] }));
    expect(await getOtterSlack(candidate, malformed)).toEqual({ state: "unavailable" });
  });
});

describe("local fulfillment cache", () => {
  test("Otter negative lookup never converts known Slack mismatch into an approval", () => {
    const previous = { slackId: "U0123456789", checkedAt: NOW - 60_000, blocked: false };
    const denied = resolveOtterIdentity(previous, { state: "not_found" }, NOW);
    expect(denied).toEqual({ slackId: null, checkedAt: NOW, blocked: true });
    const view = viewFromCache([row({
      otter_slack_id: denied.slackId, otter_identity_blocked: denied.blocked,
    })], NOW);
    expect(matchShips(view, {
      mapping: { kind: "mapped", stagingId: OTHER, unifiedId: ID },
      repoKey: "github.com/example/project", playerSlackId: "U0999999999",
    }, NOW).state).toBe("identity_mismatch");
    expect(resolveOtterIdentity(denied, { state: "not_found" }, NOW + 1).blocked).toBe(true);
    const cleared = resolveOtterIdentity(denied, { state: "verified", slackId: "U0999999999" }, NOW + 2);
    expect(cleared).toEqual({ slackId: "U0999999999", checkedAt: NOW + 2, blocked: false });
    expect(resolveOtterIdentity(previous, { state: "unavailable" }, NOW)).toEqual(previous);
    expect(resolveOtterIdentity({ slackId: null, checkedAt: 0, blocked: false },
      { state: "not_found" }, NOW).blocked).toBe(false);
  });
  test("sync health includes missing, stale, failed, and identity review records", () => {
    const good = row();
    const old = row({ staging_id: "recCCCCCCCCCCCCCC", unified_id: "recDDDDDDDDDDDDDD",
      mapping_checked_ms: NOW - 31 * 60_000, verified_at_ms: NOW - 31 * 60_000 });
    const bad = row({ staging_id: "recEEEEEEEEEEEEEE", unified_id: "recFFFFFFFFFFFFFF",
      error: "upstream unavailable" });
    const blocked = row({ staging_id: "recGGGGGGGGGGGGGG", unified_id: "recHHHHHHHHHHHHHH",
      otter_identity_blocked: true });
    const expected = [good.staging_id, old.staging_id, bad.staging_id, blocked.staging_id, "recIIIIIIIIIIIIII"];
    const view = viewFromCache([good, old, bad, blocked], NOW, expected);
    expect(view.snapshot?.syncHealth).toEqual({
      total: 5, current: 1, unsynced: 1, stale: 2, errors: 1, identityReview: 1,
    });
    expect(view.fresh).toBe(false);
    expect(view.error).toContain("1 upstream");
    expect(viewFromCache([good], NOW, [good.staging_id]).fresh).toBe(true);
    expect(viewFromCache([], NOW, [good.staging_id]).snapshot?.syncHealth.unsynced).toBe(1);
    expect(viewFromCache([], NOW, []).fresh).toBe(false);
  });
  test("staging mappings are never treated as fresh after 30 minutes", () => {
    expect(lookupFromCache([OTHER], [row()], NOW).get(OTHER)).toEqual({
      kind: "found", info: { submitted: true, unifiedId: ID },
    });
    expect(lookupFromCache([OTHER], [row()], NOW + 31 * 60_000).get(OTHER)?.kind).toBe("error");
  });
  test("a missing Unified approval cannot supply funding evidence", () => {
    const view = viewFromCache([row({ unified_state: "missing", approved_hours: null })], NOW);
    const evidence = matchShips(view, {
      mapping: { kind: "mapped", stagingId: OTHER, unifiedId: ID },
      repoKey: "github.com/example/project", playerSlackId: "U0123456789",
    }, NOW);
    expect(evidence.state).toBe("not_found");
  });
  test("a matching exact ID verifies; stale records and Slack mismatches do not", () => {
    const target = {
      mapping: { kind: "mapped" as const, stagingId: OTHER, unifiedId: ID },
      repoKey: "github.com/example/project", playerSlackId: "U0123456789",
    };
    const verified = matchShips(viewFromCache([row()], NOW), target, NOW);
    expect(verified.state).toBe("approved");
    expect(verified.hours).toBe(9.8);
    expect(matchShips(viewFromCache([row()], NOW + 31 * 60_000), target, NOW + 31 * 60_000).state).toBe("unavailable");
    expect(matchShips(viewFromCache([row()], NOW), { ...target, playerSlackId: "U0999999999" }, NOW).state).toBe("identity_mismatch");
  });
  test("duplicate Unified IDs never become verified credits", () => {
    const view = viewFromCache([row(), row({ staging_id: "recCCCCCCCCCCCCCC" })], NOW);
    expect(view.snapshot?.ambiguousIds.has(ID)).toBe(true);
    expect(view.snapshot?.byId.has(ID)).toBe(false);
  });
  test("a pending/missing record sharing a Unified ID also blocks approval", () => {
    const view = viewFromCache([
      row(), row({ staging_id: "recCCCCCCCCCCCCCC", unified_state: "missing", approved_hours: null }),
    ], NOW);
    expect(view.snapshot?.ambiguousIds.has(ID)).toBe(true);
    expect(view.snapshot?.byId.has(ID)).toBe(false);
  });
});
