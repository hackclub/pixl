import { expect, test } from "bun:test";
import { parseAuditSort, parseSortDir, sortAudits, summarizeAudits } from "./auditReviewerView";

const row = (over: Partial<Parameters<typeof sortAudits>[0][number]>) => ({
  created_at: "2026-11-01T00:00:00Z",
  approved_hours: 1 as number | null,
  claimed_hours: 1,
  total_seconds: 60,
  project_name: "p",
  verdict: "approved",
  ...over,
});

test("sorts by date in both directions", () => {
  const rows = [row({ created_at: "2026-10-01T00:00:00Z", project_name: "old" }), row({ created_at: "2026-11-05T00:00:00Z", project_name: "new" })];
  expect(sortAudits(rows, "date", "desc").map((r) => r.project_name)).toEqual(["new", "old"]);
  expect(sortAudits(rows, "date", "asc").map((r) => r.project_name)).toEqual(["old", "new"]);
});

test("sorts by approved hours and keeps rows without hours last in both directions", () => {
  const rows = [
    row({ approved_hours: null, project_name: "none" }),
    row({ approved_hours: 3, project_name: "three" }),
    row({ approved_hours: "12.5" as unknown as number, project_name: "big" }),
  ];
  expect(sortAudits(rows, "hours", "desc").map((r) => r.project_name)).toEqual(["big", "three", "none"]);
  expect(sortAudits(rows, "hours", "asc").map((r) => r.project_name)).toEqual(["three", "big", "none"]);
});

test("does not mutate the input", () => {
  const rows = [row({ claimed_hours: 5 }), row({ claimed_hours: 1 })];
  sortAudits(rows, "claimed", "asc");
  expect(rows[0]!.claimed_hours).toBe(5);
});

test("summary totals hours and counts verdicts", () => {
  const s = summarizeAudits([
    row({ approved_hours: 2, claimed_hours: 3 }),
    row({ approved_hours: null, claimed_hours: 4, verdict: "needs_changes" }),
  ]);
  expect(s).toEqual({ reviews: 2, approvedHours: 2, claimedHours: 7, byVerdict: { approved: 1, needs_changes: 1 } });
});

test("unknown sort params fall back safely", () => {
  expect(parseAuditSort("nope")).toBe("date");
  expect(parseAuditSort("hours")).toBe("hours");
  expect(parseSortDir("asc")).toBe("asc");
  expect(parseSortDir("x")).toBe("desc");
});
