import { describe, expect, test } from "bun:test";
import { ENDING_SCORE_END, ENDING_SCORE_START, endingScores, inWindow, pointsFor } from "./endingScore";

const IN = "2026-11-20T12:00:00Z";
const a = (reviewer: string, verdict: string, created_at = IN) => ({ reviewer, verdict, created_at });

describe("pointsFor", () => {
  test("approvals are 3, changes and bans are 1, the rest 0", () => {
    expect(pointsFor("approved")).toBe(3);
    expect(pointsFor("first_pass_approved")).toBe(3);
    expect(pointsFor("needs_changes")).toBe(1);
    expect(pointsFor("banned")).toBe(1);
    expect(pointsFor("first_pass_banned")).toBe(1);
    for (const v of ["reverted", "unshipped", "sent_to_first_pass", "hours_deflated", "first_pass_removed"])
      expect(pointsFor(v)).toBe(0);
  });
});

describe("window", () => {
  test("ends Monday November 30th 23:59:59 UTC, inclusive", () => {
    expect(new Date(ENDING_SCORE_END).toISOString()).toBe("2026-11-30T23:59:59.999Z");
    expect(inWindow("2026-11-30T23:59:59Z")).toBe(true);
    expect(inWindow("2026-12-01T00:00:00Z")).toBe(false);
  });
  test("starts at the contest start", () => {
    expect(inWindow(new Date(ENDING_SCORE_START - 1).toISOString())).toBe(false);
    expect(inWindow(new Date(ENDING_SCORE_START).toISOString())).toBe(true);
  });
  test("a bad date never counts", () => {
    expect(inWindow("not a date")).toBe(false);
  });
});

describe("endingScores", () => {
  test("adds points per person, keyed by slack id so a rename is one row", () => {
    const rows = endingScores([
      a("New Name (U1)", "approved"),
      a("Old Name (U1)", "first_pass_approved"),
      a("Old Name (U1)", "needs_changes"),
      a("Bee (U2)", "banned"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "U1", reviewer: "New Name (U1)", approvals: 2, others: 1, points: 7, rank: 1 });
    expect(rows[1]).toMatchObject({ key: "U2", approvals: 0, others: 1, points: 1, rank: 2 });
  });

  test("ignores verdicts outside the window and housekeeping verdicts", () => {
    const rows = endingScores([
      a("A (U1)", "approved", "2026-11-01T00:00:00Z"),
      a("A (U1)", "approved", "2026-12-01T00:00:01Z"),
      a("A (U1)", "reverted"),
      a("A (U1)", "first_pass_removed"),
    ]);
    expect(rows).toEqual([]);
  });

  test("ties share a rank, more approvals first", () => {
    const rows = endingScores([
      a("A (U1)", "approved"),
      a("B (U2)", "needs_changes"),
      a("B (U2)", "needs_changes"),
      a("B (U2)", "needs_changes"),
      a("C (U3)", "approved"),
    ]);
    expect(rows.map((r) => [r.key, r.points, r.rank])).toEqual([
      ["U1", 3, 1],
      ["U3", 3, 1],
      ["U2", 3, 3],
    ]);
  });
});
