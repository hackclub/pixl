import { describe, expect, test } from "bun:test";
import { evaluateEligibility, type EligibilityInput, type OrderInput, type ProjectEvidence } from "./engine";
import { currentPolicy } from "./policy";
import { matchShips as matchMapped, type MatchTarget } from "./shipsMatch";
import { buildSnapshot, type ShipsView } from "./ships";

const matchShips = (
  v: Parameters<typeof matchMapped>[0],
  t: { recordId: string | null; repoKey: string | null; playerSlackId: string | null },
  now?: number,
) =>
  matchMapped(
    v,
    {
      mapping: t.recordId ? { kind: "mapped", stagingId: "recSTAGING0000000", unifiedId: t.recordId } : { kind: "none" },
      repoKey: t.repoKey,
      playerSlackId: t.playerSlackId,
    } satisfies MatchTarget,
    now,
  );

const NOW = 1_800_000_000_000;
const PX = 0.1;
const REC = "recpBUYp5RAB3JEaE";
const REPO = "https://github.com/polarnl/polarlearn-v2";
const SLACK = "UPLAYER001";

const shipsRow = (over: Record<string, unknown> = {}) => ({
  id: REC,
  ysws: "Pixl",
  approved_at: Math.floor(NOW / 1000) - 5 * 86400,
  code_url: REPO,
  github_username: "polarnl",
  hours: 87,
  slack_id: "null",
  ...over,
});

const viewOf = (rows: unknown[], over: Partial<ShipsView> = {}): ShipsView => {
  const snapshot = buildSnapshot(rows, NOW - 2 * 60_000);
  return { snapshot, fetchedAt: snapshot.fetchedAt, ageMs: 2 * 60_000, fresh: true, error: null, lastAttemptAt: NOW, nextRetryAt: null, ...over };
};

const unavailable: ShipsView = { snapshot: null, fetchedAt: null, ageMs: null, fresh: false, error: "down", lastAttemptAt: NOW, nextRetryAt: null };

const project = (rows: unknown[], over: Partial<ProjectEvidence> = {}, view?: ShipsView): ProjectEvidence => {
  const base: ProjectEvidence = {
    projectId: 1,
    userId: "u1",
    name: "polarlearn-v2",
    role: "owner",
    approvedHours: 87,
    originalHours: null,
    deflated: false,
    status: "approved",
    banned: false,
    repoKey: "github.com/polarnl/polarlearn-v2",
    airtable: "submitted",
    airtableRecordId: REC,
    unified: "unverifiable",
    unifiedRef: null,
    disputed: false,
    priorApprovedHours: 0,
    ...over,
  };
  const v = view ?? viewOf(rows);
  base.ships = matchShips(v, { recordId: base.airtableRecordId, repoKey: base.repoKey, playerSlackId: SLACK }, NOW);
  return base;
};

const order = (over: Partial<OrderInput> = {}): OrderInput => ({
  id: 200,
  userId: "u1",
  itemName: "Hardware Grant",
  quantity: 16,
  pricePx: 1792,
  status: "pending",
  actualCostUsd: null,
  flagged: false,
  ...over,
});

const xm5 = (over: Partial<OrderInput> = {}): OrderInput => ({
  id: 100,
  userId: "u1",
  itemName: "Sony WH-1000XM5",
  quantity: 1,
  pricePx: 2258,
  status: "done",
  actualCostUsd: 225.8,
  flagged: false,
  ...over,
});

const meta = (view: ShipsView = viewOf([])) => ({
  loadedAt: NOW,
  commitmentsKnown: true,
  airtableAvailable: true,
  unifiedAvailable: !!view.snapshot,
  restrictions: [] as string[],
  shipsAvailable: !!view.snapshot,
  shipsFetchedAt: view.fetchedAt,
  shipsError: view.error,
});

function run(rows: unknown[], over: Partial<EligibilityInput> = {}, view?: ShipsView) {
  const v = view ?? viewOf(rows);
  return evaluateEligibility({
    policy: currentPolicy(),
    pixelValueUsd: PX,
    now: NOW,
    order: order(),
    playerOrders: [xm5()],
    ledger: [],
    projects: [project(rows, {}, v)],
    priorGrants: [],
    meta: meta(v),
    ...over,
  });
}

describe("Ships matching", () => {
  const v = viewOf([shipsRow(), shipsRow({ id: "recOTHER00000000A", code_url: "https://github.com/x/y", github_username: "x" })]);
  const target = { recordId: REC, repoKey: "github.com/polarnl/polarlearn-v2", playerSlackId: SLACK };

  test("exact record id with matching repository is approved", () => {
    const m = matchShips(v, target, NOW);
    expect(m.state).toBe("approved");
    expect(m.matchedBy).toBe("record_id");
    expect(m.hours).toBe(87);
  });

  test("a record id missing from the dataset is not_found, never approved", () => {
    expect(matchShips(v, { ...target, recordId: "recMISSING0000000" }, NOW).state).toBe("not_found");
  });

  test("a record id pointing at a different repository is an identity mismatch", () => {
    expect(matchShips(v, { ...target, repoKey: "github.com/someone/else" }, NOW).state).toBe("identity_mismatch");
  });

  test("a Slack id that disagrees with the player is an identity mismatch", () => {
    const withSlack = viewOf([shipsRow({ slack_id: "UOTHER0001" })]);
    expect(matchShips(withSlack, target, NOW).state).toBe("identity_mismatch");
    const same = viewOf([shipsRow({ slack_id: SLACK.toLowerCase() })]);
    expect(matchShips(same, target, NOW).state).toBe("approved");
  });

  test("a duplicated or malformed record id is ambiguous", () => {
    expect(matchShips(viewOf([shipsRow(), shipsRow({ hours: 1 })]), target, NOW).state).toBe("ambiguous");
    expect(matchShips(viewOf([shipsRow({ hours: -3 })]), target, NOW).state).toBe("ambiguous");
  });

  test("no approval timestamp is found but unconfirmed", () => {
    const m = matchShips(viewOf([shipsRow({ approved_at: null })]), target, NOW);
    expect(m.state).toBe("approval_unconfirmed");
    expect(m.hours).toBe(87);
  });

  test("an approval date far in the future is not trusted", () => {
    expect(matchShips(viewOf([shipsRow({ approved_at: Math.floor(NOW / 1000) + 30 * 86400 })]), target, NOW).state).toBe(
      "approval_unconfirmed",
    );
  });

  test("without a record id, repository plus verified Slack id matches when unique", () => {
    const row = shipsRow({ slack_id: SLACK });
    const m = matchShips(viewOf([row]), { ...target, recordId: null }, NOW);
    expect(m.state).toBe("approved");
    expect(m.matchedBy).toBe("repo_slack");
  });

  test("a GitHub username alone never matches", () => {
    const m = matchShips(viewOf([shipsRow()]), { ...target, recordId: null }, NOW);
    expect(m.state).toBe("ambiguous");
  });

  test("two collaborator rows on one repository need Slack ids to be told apart", () => {
    const rows = [shipsRow({ id: "recAAAAAAAAAAAAAA", slack_id: SLACK, hours: 40 }), shipsRow({ id: "recBBBBBBBBBBBBBB", slack_id: "UOTHER0001", hours: 47 })];
    const m = matchShips(viewOf(rows), { ...target, recordId: null }, NOW);
    expect(m.state).toBe("approved");
    expect(m.hours).toBe(40);
    const noSlack = matchShips(viewOf([shipsRow({ id: "recAAAAAAAAAAAAAA" }), shipsRow({ id: "recBBBBBBBBBBBBBB" })]), { ...target, recordId: null }, NOW);
    expect(noSlack.state).toBe("ambiguous");
  });

  test("no record id and no Ships entry is simply pending", () => {
    expect(matchShips(viewOf([]), { ...target, recordId: null }, NOW).state).toBe("no_record");
  });

  test("an unreachable Ships is unavailable", () => {
    expect(matchShips(unavailable, target, NOW).state).toBe("unavailable");
  });
});

describe("Andrei scenario (synthetic)", () => {
  test("the storage grant is measured against what is left after the XM5", () => {
    const r = run([shipsRow()]);
    expect(r.verifiedHours).toBe(87);
    expect(r.verifiedFundingCents).toBe(34800);
    expect(r.committedCents).toBe(22580);
    expect(r.remainingCents).toBe(12220);
    expect(r.amount.basis).toBe("face");
    expect(r.amount.cents).toBe(16000);
    expect(r.amount.budgetCents).toBe(17920);
    expect(r.afterCents).toBe(-3780);
    expect(r.status).toBe("insufficient");
    expect(r.verification).toBe("verified");
    expect(r.verificationSummary).toBe("Found in Ships · 87.0h verified");
    expect(r.reasons.some((x) => x.code === "amount_discrepancy")).toBe(true);
  });

  test("it stays insufficient under the shop budget figure too", () => {
    const r = run([shipsRow()], { order: order({ itemName: "Storage bundle", quantity: 1 }) });
    expect(r.amount.basis).toBe("budget");
    expect(r.amount.cents).toBe(17920);
    expect(r.afterCents).toBe(12220 - 17920);
    expect(r.status).toBe("insufficient");
  });

  test("a grant that fits the remaining $122.20 is covered", () => {
    const r = run([shipsRow()], { order: order({ quantity: 12, pricePx: 1344 }) });
    expect(r.amount.cents).toBe(12000);
    expect(r.afterCents).toBe(220);
    expect(r.status).toBe("covered");
  });

  test("without deducting the XM5 the same order would wrongly look affordable", () => {
    const r = run([shipsRow()], { playerOrders: [] });
    expect(r.remainingCents).toBe(34800);
    expect(r.afterCents).toBe(34800 - 16000);
  });

  test("a ledger entry takes precedence over the derived amount", () => {
    const r = run([shipsRow()], { ledger: [{ orderId: 100, amountCents: 25000 }] });
    expect(r.committedCents).toBe(25000);
    expect(r.commitments[0]!.source).toBe("ledger");
  });

  test("a cancelled earlier order releases its funds", () => {
    const r = run([shipsRow()], { playerOrders: [xm5({ status: "cancelled" })] });
    expect(r.committedCents).toBe(0);
    expect(r.status).toBe("covered");
  });

  test("an in-flight claimed order still counts while a pending one does not", () => {
    const r = run([shipsRow()], { playerOrders: [xm5({ status: "ordered" }), xm5({ id: 101, status: "pending", actualCostUsd: 100 })] });
    expect(r.committedCents).toBe(22580);
  });
});

describe("verification outcomes", () => {
  test("Airtable submitted but absent from Ships is Unverified, not rejected", () => {
    const r = run([], { order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) });
    expect(r.status).toBe("unverified");
    expect(r.verification).toBe("not_found");
    expect(r.verificationSummary).toContain("awaiting Ships verification");
    expect(r.verifiedFundingCents).toBe(0);
  });

  test("not yet submitted from staging reads as pending submission", () => {
    const v = viewOf([]);
    const p = project([], { airtable: "present" }, v);
    const r = run([], { projects: [p] }, v);
    expect(r.verification).toBe("pending_submission");
    expect(r.status).not.toBe("covered");
  });

  test("approval timestamp absent keeps the hours provisional", () => {
    const r = run([shipsRow({ approved_at: null })]);
    expect(r.verification).toBe("approval_unconfirmed");
    expect(r.status).not.toBe("covered");
    expect(r.verifiedHours).toBe(0);
    expect(r.provisionalHours).toBe(87);
  });

  test("Ships unreachable never produces Covered", () => {
    const v = unavailable;
    const r = run([], { order: order({ quantity: 1, pricePx: 10 }) }, v);
    expect(r.status).toBe("unverified");
    expect(r.verification).toBe("unavailable");
    expect(r.reasons.some((x) => x.code === "unified_unavailable")).toBe(true);
  });

  test("identity problems force manual review", () => {
    const r = run([shipsRow({ slack_id: "UOTHER0001" })], { order: order({ quantity: 1, pricePx: 10 }) });
    expect(r.status).toBe("review_required");
    expect(r.verification).toBe("needs_review");
  });

  test("a duplicated record id forces manual review", () => {
    const r = run([shipsRow(), shipsRow({ hours: 2 })], { order: order({ quantity: 1, pricePx: 10 }) });
    expect(r.status).toBe("review_required");
  });

  test("a stale snapshot downgrades Covered to Unverified", () => {
    const old = viewOf([shipsRow()]);
    old.snapshot!.fetchedAt = NOW - 45 * 60_000;
    old.fetchedAt = NOW - 45 * 60_000;
    old.ageMs = 45 * 60_000;
    old.fresh = false;
    const r = run([], { order: order({ quantity: 1, pricePx: 10 }) }, old);
    expect(r.ships.stale).toBe(true);
    expect(r.status).toBe("unverified");
    expect(r.reasons.some((x) => x.code === "ships_stale")).toBe(true);
  });

  test("a failed refresh with a still-recent snapshot is disclosed, and age is the real age", () => {
    const v = viewOf([shipsRow()], { error: "Ships returned HTTP 500", fresh: false });
    const r = run([], { order: order({ quantity: 1, pricePx: 10 }) }, v);
    expect(r.status).toBe("covered");
    expect(r.ships.ageMs).toBe(2 * 60_000);
    expect(r.reasons.some((x) => x.code === "ships_refresh_failing")).toBe(true);
  });

  test("a banned project is restricted regardless of Ships", () => {
    const v = viewOf([shipsRow()]);
    const r = run([], { meta: { ...meta(v), restrictions: ["Player has a banned project."] } }, v);
    expect(r.status).toBe("restricted");
  });
});

describe("hour discrepancies", () => {
  const rounding = (airtable: number, ships: number) => {
    const v = viewOf([shipsRow({ hours: ships })]);
    return { v, p: project([], { approvedHours: airtable }, v) };
  };

  test("Ships 3h vs Airtable 3.1h counts the lower figure", () => {
    const { v, p } = rounding(3.1, 3);
    const r = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 120 }) }, v);
    expect(r.verifiedHours).toBe(3);
    expect(r.projects[0]!.discrepancy).toBe("rounding");
    expect(r.status).toBe("covered");
    expect(r.reasons.some((x) => x.code === "hours_rounding")).toBe(true);
  });

  test("when the discrepancy decides the order it goes to manual review", () => {
    const { v, p } = rounding(3.1, 3);
    const r = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 124 }) }, v);
    expect(r.verifiedFundingCents).toBe(1200);
    expect(r.verifiedHighFundingCents).toBe(1240);
    expect(r.status).toBe("review_required");
    expect(r.reasons.some((x) => x.code === "hours_discrepancy")).toBe(true);
  });

  test("when even the higher figure cannot pay, it is simply insufficient", () => {
    const { v, p } = rounding(3.1, 3);
    const r = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 500 }) }, v);
    expect(r.status).toBe("insufficient");
  });

  test("Ships reporting more hours than Airtable never raises funding", () => {
    const { v, p } = rounding(3.1, 8);
    const r = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 124 }) }, v);
    expect(r.verifiedHours).toBe(3.1);
    expect(r.projects[0]!.discrepancy).toBe("material");
    expect(r.status).toBe("covered");
  });

  test("Ships reporting fewer hours than Airtable (deflation) lowers funding", () => {
    const { v, p } = rounding(20, 10);
    const big = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 900 }) }, v);
    expect(big.verifiedHours).toBe(10);
    expect(big.status).toBe("insufficient");
    const mid = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 500 }) }, v);
    expect(mid.status).toBe("review_required");
  });

  test("a re-shipped project verifies only the hours in its own record", () => {
    const v = viewOf([shipsRow({ hours: 3 })]);
    const p = project([], { approvedHours: 90, priorApprovedHours: 87 }, v);
    const r = run([], { projects: [p], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 500 }) }, v);
    expect(r.verifiedHours).toBe(3);
    expect(r.provisionalHours).toBe(87);
    expect(r.status).toBe("unverified");
    const multi = r.reasons.find((x) => x.code === "multi_record_hours")!;
    expect(multi).toBeTruthy();
    expect(multi.message).not.toContain("other PIXL record");
    const v2 = viewOf([shipsRow({ hours: 3 }), shipsRow({ id: "recEARLIER0000000", hours: 87 })]);
    const p2 = project([], { approvedHours: 90, priorApprovedHours: 87 }, v2);
    const r2 = run([], { projects: [p2], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 500 }) }, v2);
    expect(r2.reasons.find((x) => x.code === "multi_record_hours")!.message).toContain("1 other PIXL record for this repository (87h)");
    expect(r2.verifiedHours).toBe(3);
  });
});

describe("several projects and collaborators", () => {
  const A = "recAAAAAAAAAAAAAA";
  const B = "recBBBBBBBBBBBBBB";
  const C = "recCCCCCCCCCCCCCC";

  test("hours from several verified projects add up once each", () => {
    const rows = [
      shipsRow({ id: A, code_url: "https://github.com/a/one", hours: 10 }),
      shipsRow({ id: B, code_url: "https://github.com/a/two", hours: 20 }),
    ];
    const v = viewOf(rows);
    const ps = [
      project([], { projectId: 1, airtableRecordId: A, repoKey: "github.com/a/one", approvedHours: 10 }, v),
      project([], { projectId: 2, airtableRecordId: B, repoKey: "github.com/a/two", approvedHours: 20 }, v),
    ];
    const r = run([], { projects: ps, playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) }, v);
    expect(r.verifiedHours).toBe(30);
    expect(r.status).toBe("covered");
  });

  test("a collaborator counts their own row, and the owner's row is a separate record", () => {
    const rows = [
      shipsRow({ id: A, hours: 40, slack_id: "UOWNER0001" }),
      shipsRow({ id: B, hours: 47, slack_id: SLACK }),
    ];
    const v = viewOf(rows);
    const collab = project([], { role: "collaborator", airtableRecordId: B, approvedHours: 47 }, v);
    const r = run([], { projects: [collab], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) }, v);
    expect(r.verifiedHours).toBe(47);
    expect(r.projects[0]!.ships!.recordId).toBe(B);
    expect(r.status).toBe("covered");
  });

  test("a collaborator row carrying the owner's Slack id is rejected", () => {
    const v = viewOf([shipsRow({ id: A, hours: 40, slack_id: "UOWNER0001" })]);
    const collab = project([], { role: "collaborator", airtableRecordId: A, approvedHours: 40 }, v);
    const r = run([], { projects: [collab], playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) }, v);
    expect(r.status).toBe("review_required");
    expect(r.verifiedHours).toBe(0);
  });

  test("two projects on the same repository are not counted twice", () => {
    const v = viewOf([shipsRow({ id: A }), shipsRow({ id: B, hours: 3 })]);
    const ps = [
      project([], { projectId: 1, airtableRecordId: A }, v),
      project([], { projectId: 2, airtableRecordId: B, approvedHours: 3 }, v),
    ];
    const r = run([], { projects: ps, playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) }, v);
    expect(r.verifiedHours).toBe(87);
    expect(r.status).toBe("review_required");
  });

  test("unrelated Ships rows for the same GitHub user are ignored", () => {
    const v = viewOf([shipsRow(), shipsRow({ id: C, ysws: "Macondo", hours: 500 })]);
    const r = run([], { playerOrders: [], order: order({ itemName: "Cable", quantity: 1, pricePx: 100 }) }, v);
    expect(r.verifiedHours).toBe(87);
  });
});
