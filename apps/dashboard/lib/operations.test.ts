import { describe, expect, test } from "bun:test";
import { ALL_PERMISSIONS, SUBADMIN_PERMISSIONS } from "./guard";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TRIAL_HOLD_NOTE, effectiveStatusOf, maxApprovableHours, settleNoteText, type BlackoutEntry } from "./operations";
import { isBlackoutReviewable, parseBlackoutForm } from "./operationsReview";

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

const entry = (over: Partial<BlackoutEntry> = {}): BlackoutEntry => ({
  id: 1,
  projectId: 7,
  status: "shipped",
  joinedAt: at(-3),
  windowStart: at(-3),
  firstQualifiedShipAt: at(-1),
  latestShipAt: at(-1),
  reshipCount: 0,
  rateUsdSnapshot: 5,
  gracePeriodHoursSnapshot: 72,
  decision: null,
  decisionNote: "",
  decidedBy: "",
  decisionStage: "",
  changesRequestedAt: null,
  graceDeadline: null,
  fixWindowEnd: null,
  systemReason: "",
  contributors: [person("a"), person("b", 2 * 3600)],
  operation: {
    id: 1, slug: "operation-blackout", name: "Operation Blackout",
    startsAt: at(-10), endsAt: at(24), status: "active", effectiveStatus: "active",
    rateUsd: 5, gracePeriodHours: 72,
  },
  ...over,
});

describe("operation permission model", () => {
  test("17. operations is its own permission, grantable from /admins, not implied by review", () => {
    expect(ALL_PERMISSIONS).toContain("operations");
    expect(SUBADMIN_PERMISSIONS).toContain("operations");
    expect(ALL_PERMISSIONS).toContain("review");
  });
});

describe("effectiveStatusOf", () => {
  test("follows the clock unless paused/ended by an admin", () => {
    expect(effectiveStatusOf("active", at(-1), at(5))).toBe("active");
    expect(effectiveStatusOf("upcoming", at(2), at(9))).toBe("upcoming");
    expect(effectiveStatusOf("active", at(-9), at(-1))).toBe("ended");
    expect(effectiveStatusOf("paused", at(-1), at(5))).toBe("paused");
    expect(effectiveStatusOf("ended", at(-1), at(5))).toBe("ended");
  });
});

describe("reviewer input", () => {
  test("5. an entry is reviewable after review even when the event is over (status is never consulted)", () => {
    const e = entry({ operation: { ...entry().operation, status: "ended", effectiveStatus: "ended" } });
    expect(isBlackoutReviewable(e)).toBe(true);
  });
  test("settled, system-decided, never-shipped and no-entry are not the reviewer's to rule on", () => {
    expect(isBlackoutReviewable(null)).toBe(false);
    expect(isBlackoutReviewable(entry({ status: "approved" }))).toBe(false);
    expect(isBlackoutReviewable(entry({ status: "entered", firstQualifiedShipAt: null }))).toBe(false);
    expect(isBlackoutReviewable(entry({ status: "ineligible", decidedBy: "system" }))).toBe(false);
    expect(isBlackoutReviewable(entry({ status: "needs_changes" }))).toBe(false);
    expect(isBlackoutReviewable(entry({ status: "ineligible", decidedBy: "Rev (U1)" }))).toBe(true);
  });
  test("18. the form can carry a decision, a note and hours, and nothing else: a rate is ignored", () => {
    const fd = new FormData();
    fd.set("blackoutDecision", "eligible");
    fd.set("blackoutNote", "  checked the repo  ");
    fd.set("blackoutHours_a", "3.456");
    fd.set("blackoutHours_b", "1");
    fd.set("blackoutRate", "100");
    fd.set("rateUsd", "100");
    fd.set("blackoutHours_stranger", "999");
    const parsed = parseBlackoutForm(fd, entry());
    expect(parsed).toEqual({
      decision: "eligible",
      note: "checked the repo",
      hours: [
        { user_id: "a", hours: 3.46 },
        { user_id: "b", hours: 1 },
      ],
    });
    expect(Object.keys(parsed).sort()).toEqual(["decision", "hours", "note"]);
  });
  test("a missing or garbage decision is null, garbage hours are flagged invalid for the database to refuse", () => {
    const fd = new FormData();
    fd.set("blackoutDecision", "sure");
    fd.set("blackoutHours_a", "abc");
    const parsed = parseBlackoutForm(fd, entry());
    expect(parsed.decision).toBeNull();
    expect(parsed.hours[0]).toEqual({ user_id: "a", hours: -1 });
    expect(parsed.hours[1]).toEqual({ user_id: "b", hours: 0 });
  });
  test("7. the approvable ceiling is the trusted tracked time, per person", () => {
    expect(maxApprovableHours(person("a", 4 * 3600))).toBe(4);
    expect(maxApprovableHours(person("b", 2.5 * 3600))).toBe(2.5);
    expect(maxApprovableHours(person("c", 0))).toBe(0);
  });
  test("the trial hold skip is explained in plain words, other notes pass through", () => {
    expect(settleNoteText(TRIAL_HOLD_NOTE)).toContain("Trial prize pending");
    expect(settleNoteText("not credited on the normal payout")).toBe("not credited on the normal payout");
  });
  test("every operations admin action checks the operations permission before doing anything", () => {
    const src = readFileSync(join(import.meta.dir, "../app/operations/actions.ts"), "utf8");
    const fns = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]+)/g)];
    expect(fns.map((m) => m[1]).sort()).toEqual(["createOperation", "operationControl"]);
    for (const m of fns) expect(m[2]).toContain('await requirePerm("operations")');
  });
});
