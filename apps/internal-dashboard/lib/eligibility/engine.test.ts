import { describe, expect, test } from "bun:test";
import {
  evaluateEligibility,
  orderAmount,
  type EligibilityInput,
  type OrderInput,
  type ProjectEvidence,
} from "./engine";
import { currentPolicy, POLICIES } from "./policy";

const FLAT = POLICIES["2026-10-22.2"]!;

const NOW = 1_800_000_000_000;
const PX = 0.1;

const project = (over: Partial<ProjectEvidence> = {}): ProjectEvidence => ({
  projectId: 1,
  userId: "u1",
  name: "Proj",
  role: "owner",
  approvedHours: 10,
  originalHours: null,
  deflated: false,
  status: "approved",
  banned: false,
  repoKey: null,
  airtable: "submitted",
  airtableRecordId: "recAAAAAAAAAAAAAA",
  unified: "confirmed",
  unifiedRef: "unified-1",
  disputed: false,
  ...over,
});

const order = (over: Partial<OrderInput> = {}): OrderInput => ({
  id: 100,
  userId: "u1",
  itemName: "Mechanical Keyboard",
  quantity: 1,
  pricePx: 100,
  status: "pending",
  actualCostUsd: null,
  flagged: false,
  ...over,
});

const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  policy: FLAT,
  pixelValueUsd: PX,
  now: NOW,
  order: order(),
  playerOrders: [],
  ledger: [],
  projects: [project()],
  priorGrants: [],
  meta: { loadedAt: NOW, commitmentsKnown: true, airtableAvailable: true, unifiedAvailable: true, restrictions: [] },
  ...over,
});

const run = (over: Partial<EligibilityInput> = {}) => evaluateEligibility(input(over));

describe("policy rate", () => {
  test("verified hours fund at $4 each", () => {
    const r = run();
    expect(r.rateUsd).toBe(4);
    expect(r.verifiedHours).toBe(10);
    expect(r.verifiedFundingCents).toBe(4000);
  });

  test("covered when verified funding exceeds the order", () => {
    const r = run();
    expect(r.status).toBe("covered");
    expect(r.amount.cents).toBe(1000);
    expect(r.afterCents).toBe(3000);
  });

  test("exactly equal funding is covered", () => {
    expect(run({ order: order({ pricePx: 400 }) }).status).toBe("covered");
  });

  test("one cent over is not covered", () => {
    expect(run({ order: order({ pricePx: 401 }), projects: [project({ approvedHours: 10 })] }).status).toBe("insufficient");
  });
});

describe("multiple projects and collaborators", () => {
  test("sums hours across a player's projects", () => {
    const r = run({
      projects: [project({ projectId: 1, approvedHours: 3 }), project({ projectId: 2, approvedHours: 4.5 })],
    });
    expect(r.verifiedHours).toBe(7.5);
    expect(r.verifiedFundingCents).toBe(3000);
  });

  test("a collaborator row counts that person's own hours", () => {
    const r = run({
      projects: [project({ projectId: 1, role: "collaborator", approvedHours: 6 })],
    });
    expect(r.verifiedHours).toBe(6);
  });

  test("owner and collaborator rows for the same project are counted once", () => {
    const r = run({
      projects: [
        project({ projectId: 1, role: "collaborator", approvedHours: 6 }),
        project({ projectId: 1, role: "owner", approvedHours: 6 }),
      ],
    });
    expect(r.verifiedHours).toBe(6);
    expect(r.projects.filter((p) => p.counted === "excluded")).toHaveLength(1);
  });

  test("two projects on the same repository count once and need review", () => {
    const r = run({
      projects: [
        project({ projectId: 1, repoKey: "github.com/a/b", approvedHours: 5 }),
        project({ projectId: 2, repoKey: "github.com/a/b", approvedHours: 5 }),
      ],
    });
    expect(r.verifiedHours).toBe(5);
    expect(r.status).toBe("review_required");
    expect(r.reasons.some((x) => x.code === "duplicate_submission")).toBe(true);
  });

  test("unapproved, banned and zero-hour projects are excluded", () => {
    const r = run({
      projects: [
        project({ projectId: 1, status: "pending" }),
        project({ projectId: 2, banned: true }),
        project({ projectId: 3, approvedHours: 0 }),
        project({ projectId: 4, approvedHours: 2 }),
      ],
    });
    expect(r.verifiedHours).toBe(2);
  });
});

describe("multiple orders and previous commitments", () => {
  test("claimed orders of the same player reduce availability", () => {
    const r = run({
      playerOrders: [order({ id: 7, status: "ordered", pricePx: 150 }), order({ id: 8, status: "done", pricePx: 50 })],
    });
    expect(r.committedCents).toBe(2000);
    expect(r.remainingCents).toBe(2000);
    expect(r.afterCents).toBe(1000);
  });

  test("pending orders of the same player do not count until claimed", () => {
    const r = run({ playerOrders: [order({ id: 7, status: "pending", pricePx: 300 })] });
    expect(r.committedCents).toBe(0);
  });

  test("the order being evaluated never commits against itself", () => {
    const self = order({ id: 100, status: "ordered" });
    const r = run({ order: self, playerOrders: [self] });
    expect(r.committedCents).toBe(0);
  });

  test("second order is insufficient after the first uses the balance", () => {
    const r = run({
      projects: [project({ approvedHours: 5 })],
      playerOrders: [order({ id: 7, status: "credited", pricePx: 150 })],
      order: order({ id: 9, pricePx: 100 }),
    });
    expect(r.remainingCents).toBe(500);
    expect(r.status).toBe("insufficient");
  });

  test("ledger amount overrides the derived amount", () => {
    const r = run({
      playerOrders: [order({ id: 7, status: "ordered", pricePx: 150 })],
      ledger: [{ orderId: 7, amountCents: 1200 }],
    });
    expect(r.commitments[0]).toMatchObject({ cents: 1200, source: "ledger" });
  });

  test("legacy claimed orders without a ledger row are derived and labelled", () => {
    const r = run({ playerOrders: [order({ id: 7, status: "shipped", pricePx: 100 })] });
    expect(r.commitments[0]).toMatchObject({ cents: 1000, source: "derived" });
  });

  test("project funding grants already issued are subtracted", () => {
    const r = run({ priorGrants: [{ projectId: 1, name: "Proj", usd: 25, deductedPx: 0, ambiguous: false }] });
    expect(r.priorGrantCents).toBe(2500);
    expect(r.remainingCents).toBe(1500);
  });

  test("partial fulfillment: prior spend plus this order beyond funds is insufficient", () => {
    const r = run({
      projects: [project({ approvedHours: 10 })],
      priorGrants: [{ projectId: 1, name: "Proj", usd: 20, deductedPx: 0, ambiguous: false }],
      playerOrders: [order({ id: 7, status: "done", pricePx: 100 })],
      order: order({ id: 9, pricePx: 100 }),
    });
    expect(r.remainingCents).toBe(1000);
    expect(r.afterCents).toBe(0);
    expect(r.status).toBe("covered");
    const over = run({
      projects: [project({ approvedHours: 10 })],
      priorGrants: [{ projectId: 1, name: "Proj", usd: 20, deductedPx: 0, ambiguous: false }],
      playerOrders: [order({ id: 7, status: "done", pricePx: 100 })],
      order: order({ id: 9, pricePx: 101 }),
    });
    expect(over.status).toBe("insufficient");
  });
});

describe("cancellations and refunds", () => {
  test("cancelled orders stop counting", () => {
    const r = run({ playerOrders: [order({ id: 7, status: "cancelled", pricePx: 300 })] });
    expect(r.committedCents).toBe(0);
  });

  test("a cancelled order evaluates to zero", () => {
    expect(orderAmount(order({ status: "cancelled", pricePx: 500 }), currentPolicy(), PX).cents).toBe(0);
  });

  test("a refunded order frees funds for the next order", () => {
    const before = run({
      projects: [project({ approvedHours: 5 })],
      playerOrders: [order({ id: 7, status: "ordered", pricePx: 200 })],
      order: order({ id: 9, pricePx: 100 }),
    });
    expect(before.status).toBe("insufficient");
    const after = run({
      projects: [project({ approvedHours: 5 })],
      playerOrders: [order({ id: 7, status: "cancelled", pricePx: 200 })],
      order: order({ id: 9, pricePx: 100 }),
    });
    expect(after.status).toBe("covered");
  });
});

describe("which dollar value counts", () => {
  test("grant face value beats the shop budget", () => {
    const a = orderAmount(order({ itemName: "Hardware Grant", quantity: 2, pricePx: 224 }), currentPolicy(), PX);
    expect(a).toMatchObject({ cents: 2000, basis: "face", budgetCents: 2240, faceCents: 2000 });
  });

  test("grant face value is used even when a supplier cost is recorded", () => {
    const a = orderAmount(order({ itemName: "Hardware Grant", quantity: 2, pricePx: 224, actualCostUsd: 22.4 }), currentPolicy(), PX);
    expect(a.cents).toBe(2000);
    expect(a.actualCents).toBe(2240);
  });

  test("recorded supplier cost beats the shop budget for ordinary items", () => {
    const a = orderAmount(order({ pricePx: 100, actualCostUsd: 8.37 }), currentPolicy(), PX);
    expect(a).toMatchObject({ cents: 837, basis: "actual", budgetCents: 1000 });
  });

  test("budget is the ceiling estimate before cost is known", () => {
    const a = orderAmount(order({ pricePx: 123 }), currentPolicy(), PX);
    expect(a).toMatchObject({ cents: 1230, basis: "budget" });
  });

  test("pixels paid never change the counted amount", () => {
    const cheap = orderAmount(order({ pricePx: 10, actualCostUsd: 5 }), currentPolicy(), PX);
    const dear = orderAmount(order({ pricePx: 900, actualCostUsd: 5 }), currentPolicy(), PX);
    expect(cheap.cents).toBe(dear.cents);
  });

  test("a 2x $10 grant against $20 funding is covered although the budget is $22.40", () => {
    const r = run({
      projects: [project({ approvedHours: 5 })],
      order: order({ itemName: "Hardware Grant", quantity: 2, pricePx: 224 }),
    });
    expect(r.verifiedFundingCents).toBe(2000);
    expect(r.status).toBe("covered");
    expect(r.afterCents).toBe(0);
  });

  test("supplier cost above budget requires review", () => {
    const r = run({ order: order({ pricePx: 100, actualCostUsd: 14 }) });
    expect(r.status).toBe("review_required");
    expect(r.reasons.some((x) => x.code === "above_budget")).toBe(true);
  });

  test("over-budget flag requires review", () => {
    expect(run({ order: order({ flagged: true }) }).status).toBe("review_required");
  });

  test("a zero-priced order requires review", () => {
    expect(run({ order: order({ pricePx: 0 }) }).status).toBe("review_required");
  });
});

describe("Unified and Airtable evidence", () => {
  test("never reports unverified hours as confirmed", () => {
    const r = run({ projects: [project({ unified: "unverifiable", airtable: "submitted" })] });
    expect(r.verifiedHours).toBe(0);
    expect(r.provisionalHours).toBe(10);
    expect(r.status).toBe("unverified");
  });

  test("pending Unified records are unverified", () => {
    const r = run({ projects: [project({ unified: "pending" })] });
    expect(r.status).toBe("unverified");
    expect(r.projects[0]!.counted).toBe("provisional");
  });

  test("a present Airtable row alone is not confirmation", () => {
    const r = run({ projects: [project({ unified: "unverifiable", airtable: "present" })] });
    expect(r.status).toBe("unverified");
    expect(r.verifiedFundingCents).toBe(0);
  });

  test("removed from Unified is excluded", () => {
    const r = run({ projects: [project({ unified: "removed" })] });
    expect(r.verifiedHours).toBe(0);
    expect(r.projects[0]!.excludedReason).toBe("removed from Unified");
    expect(r.status).toBe("insufficient");
  });

  test("disputed hours need review and are not verified", () => {
    const r = run({ projects: [project({ unified: "confirmed", disputed: true })] });
    expect(r.status).toBe("review_required");
    expect(r.verifiedHours).toBe(0);
  });

  test("a missing Airtable staging record needs review", () => {
    const r = run({ projects: [project({ airtable: "missing" })] });
    expect(r.status).toBe("review_required");
  });

  test("insufficient is definitive when even unverified hours cannot cover it", () => {
    const r = run({
      projects: [project({ unified: "unverifiable", approvedHours: 1 })],
      order: order({ pricePx: 500 }),
    });
    expect(r.status).toBe("insufficient");
  });

  test("no integration is called out in the reasons", () => {
    const r = run({
      meta: { loadedAt: NOW, commitmentsKnown: true, airtableAvailable: true, unifiedAvailable: false, restrictions: [] },
      projects: [project({ unified: "unverifiable" })],
    });
    expect(r.status).toBe("unverified");
    expect(r.reasons.some((x) => x.code === "unified_unavailable")).toBe(true);
  });

  test("a player without projects cannot be mapped", () => {
    const r = run({ projects: [] });
    expect(r.status).toBe("review_required");
    expect(r.reasons.some((x) => x.code === "no_projects")).toBe(true);
  });
});

describe("clawbacks and deflation", () => {
  test("deflated hours count at the corrected figure only", () => {
    const r = run({ projects: [project({ approvedHours: 4, originalHours: 10, deflated: true })] });
    expect(r.verifiedHours).toBe(4);
    expect(r.verifiedFundingCents).toBe(1600);
    expect(r.projects[0]!.originalHours).toBe(10);
  });

  test("an order that was covered before deflation becomes insufficient after", () => {
    const before = run({ order: order({ pricePx: 300 }) });
    expect(before.status).toBe("covered");
    const after = run({
      order: order({ pricePx: 300 }),
      projects: [project({ approvedHours: 4, originalHours: 10, deflated: true })],
    });
    expect(after.status).toBe("insufficient");
  });

  test("a reverted project stops funding the player", () => {
    const r = run({ projects: [project({ status: "pending" })] });
    expect(r.verifiedHours).toBe(0);
  });
});

describe("stale and missing evidence", () => {
  test("stale evidence cannot be covered", () => {
    const r = run({ meta: { loadedAt: NOW - 7 * 3600_000, commitmentsKnown: true, airtableAvailable: true, unifiedAvailable: true, restrictions: [] } });
    expect(r.stale).toBe(true);
    expect(r.status).toBe("unverified");
    expect(r.reasons.some((x) => x.code === "stale_evidence")).toBe(true);
  });

  test("fresh evidence at the boundary is accepted", () => {
    const r = run({ meta: { loadedAt: NOW - 6 * 3600_000, commitmentsKnown: true, airtableAvailable: true, unifiedAvailable: true, restrictions: [] } });
    expect(r.status).toBe("covered");
  });

  test("unknown commitments are unverified, never covered", () => {
    const r = run({ meta: { loadedAt: NOW, commitmentsKnown: false, airtableAvailable: true, unifiedAvailable: true, restrictions: [] } });
    expect(r.status).toBe("unverified");
  });

  test("an unreachable Airtable is surfaced", () => {
    const r = run({ meta: { loadedAt: NOW, commitmentsKnown: true, airtableAvailable: false, unifiedAvailable: true, restrictions: [] } });
    expect(r.reasons.some((x) => x.code === "airtable_unavailable")).toBe(true);
  });
});

describe("restrictions", () => {
  test("restricted outranks everything else", () => {
    const r = run({
      order: order({ flagged: true }),
      meta: { loadedAt: NOW, commitmentsKnown: true, airtableAvailable: true, unifiedAvailable: true, restrictions: ["Player has a banned project."] },
    });
    expect(r.status).toBe("restricted");
  });
});

describe("policy versioning", () => {
  test("the result records the policy version it was judged under", () => {
    expect(run().policyVersion).toBe(FLAT.version);
  });

  test("a different rate changes funding", () => {
    const r = run({ policy: { ...FLAT, version: "test", ratePerHourUsd: 5 } });
    expect(r.verifiedFundingCents).toBe(5000);
    expect(r.policyVersion).toBe("test");
  });
});
