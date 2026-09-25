import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BlackoutEntry } from "./operations";

// Fail-closed regression: a Blackout decision must never be finalized
// against evidence we couldn't confirm is current. If refreshBlackoutEvidence
// fails (PixlServer unreachable, or the refresh itself errors),
// applyBlackoutDecision must abort BEFORE calling operationRpc.reviewDecision
// - no status change, no settlement, no stale-hours payout. Both @/lib/db
// and @/lib/gameServer's real network calls are swapped out here so this
// exercises only that control-flow guarantee.

const H = 3600_000;
const now = Date.now();
const at = (h: number) => new Date(now + h * H).toISOString();

const person = (userId: string, eligibleTrackedSeconds = 4 * 3600) => ({
  userId,
  name: userId,
  role: "owner" as const,
  hackatimeBaseSeconds: eligibleTrackedSeconds,
  journalBaseSeconds: 0,
  fixTrackedSeconds: 0,
  eligibleTrackedSeconds,
  evidenceOk: true,
  evidenceAt: null,
  approvedHours: null,
  paidHours: 0,
  normalUsdRate: null,
  effectiveUsdRate: null,
  grossPx: 0,
  upliftPx: 0,
  settled: false,
  settleNote: "",
});

const baseEntry = (over: Partial<BlackoutEntry> = {}): BlackoutEntry => ({
  id: 42,
  projectId: 7,
  status: "shipped",
  joinedAt: at(-3),
  windowStart: at(-3),
  firstQualifiedShipAt: at(-1),
  latestShipAt: at(-1),
  reshipCount: 0,
  rateUsdSnapshot: 1,
  rateModeSnapshot: "additive",
  gracePeriodHoursSnapshot: 72,
  decision: null,
  decisionNote: "",
  decidedBy: "",
  decisionStage: "",
  changesRequestedAt: null,
  graceDeadline: null,
  fixWindowEnd: null,
  systemReason: "",
  contributors: [person("a", 4 * 3600)],
  operation: {
    id: 1,
    slug: "operation-blackout",
    name: "Operation Blackout",
    startsAt: at(-10),
    endsAt: at(24),
    status: "active",
    effectiveStatus: "active",
    rateUsd: 1,
    rateMode: "additive",
    gracePeriodHours: 72,
  },
  ...over,
});

let refreshResult = true;
let refreshCalls: number[] = [];
let reviewDecisionCalls: unknown[] = [];
let getBlackoutEntryCalls = 0;

mock.module("@/lib/gameServer", () => ({
  refreshBlackoutEvidence: async (entryId: number) => {
    refreshCalls.push(entryId);
    return refreshResult;
  },
}));

mock.module("@/lib/operations", () => ({
  ERROR_TEXT: {},
  getBlackoutEntry: async () => {
    getBlackoutEntryCalls++;
    return baseEntry();
  },
  operationRpc: {
    reviewDecision: async (a: unknown) => {
      reviewDecisionCalls.push(a);
      return { ok: true, status: "eligible" };
    },
  },
}));

const { applyBlackoutDecision } = await import("./operationsReview");

function form(decision: string, hours: Record<string, number>): FormData {
  const fd = new FormData();
  fd.set("blackoutDecision", decision);
  fd.set("blackoutNote", "looks fine");
  for (const [k, v] of Object.entries(hours)) fd.set(`blackoutHours_${k}`, String(v));
  return fd;
}

describe("applyBlackoutDecision fails closed on a failed evidence refresh", () => {
  beforeEach(() => {
    refreshCalls = [];
    reviewDecisionCalls = [];
    getBlackoutEntryCalls = 0;
  });

  test("a failed refresh aborts before any decision is applied - no stale-evidence payout", async () => {
    refreshResult = false;
    const err = await applyBlackoutDecision({
      projectId: 7,
      formData: form("eligible", { a: 4 }),
      by: "reviewer",
      stage: "final",
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/retry|try again/i);
    expect(refreshCalls).toEqual([42]);
    // reviewDecision is the only thing that can change status or trigger a
    // payout - it must never be reached when the refresh failed.
    expect(reviewDecisionCalls).toHaveLength(0);
    // Only the initial read happened; the re-read only happens after a
    // *successful* refresh.
    expect(getBlackoutEntryCalls).toBe(1);
  });

  test("a successful refresh re-reads the entry and lets the decision through", async () => {
    refreshResult = true;
    const err = await applyBlackoutDecision({
      projectId: 7,
      formData: form("eligible", { a: 4 }),
      by: "reviewer",
      stage: "final",
    });
    expect(err).toBeNull();
    expect(refreshCalls).toEqual([42]);
    expect(reviewDecisionCalls).toHaveLength(1);
    expect(getBlackoutEntryCalls).toBe(2);
  });
});
