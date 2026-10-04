import { describe, expect, test } from "bun:test";
import { summarizeWindow, slackIdFromLabel, bucketFor } from "./reviewStats";

const d = (iso: string) => iso;
const row = (reviewer: string, verdict: string, created_at: string) => ({ reviewer, verdict, created_at });

describe("slackIdFromLabel", () => {
  test("pulls the id out of a 'Name (ID)' label", () => {
    expect(slackIdFromLabel("Ada (U0ABC123)")).toBe("U0ABC123");
    expect(slackIdFromLabel("Ada")).toBeNull();
  });
});

describe("bucketFor", () => {
  test("only the four outcome verdicts are bucketed", () => {
    expect(bucketFor("approved")).toBe("approved");
    expect(bucketFor("first_pass_approved")).toBe("firstPass");
    expect(bucketFor("needs_changes")).toBe("changes");
    expect(bucketFor("banned")).toBe("rejected");
    expect(bucketFor("unshipped")).toBeNull();
    expect(bucketFor("reverted")).toBeNull();
  });
});

describe("summarizeWindow", () => {
  const audits = [
    row("Ada (U1)", "approved", d("2026-10-04T10:00:00Z")),
    row("Ada (U1)", "needs_changes", d("2026-10-04T11:00:00Z")),
    row("Bo (U2)", "first_pass_approved", d("2026-10-03T09:00:00Z")),
    row("Cy (U3)", "banned", d("2026-09-01T09:00:00Z")),
    row("Di (U4)", "unshipped", d("2026-10-04T12:00:00Z")),
  ];

  test("all time counts every reviewer who submitted an outcome verdict", () => {
    const s = summarizeWindow(audits, null);
    expect(s.reviewers).toBe(3);
    expect(s.counts).toEqual({ approved: 1, firstPass: 1, changes: 1, rejected: 1 });
  });

  test("respects the window start", () => {
    const since = Date.UTC(2026, 9, 4);
    const s = summarizeWindow(audits, since);
    expect(s.reviewers).toBe(1);
    expect(s.counts).toEqual({ approved: 1, firstPass: 0, changes: 1, rejected: 0 });
  });

  test("a reviewer with several reviews counts once", () => {
    expect(summarizeWindow(audits.slice(0, 2), null).reviewers).toBe(1);
  });

  test("housekeeping-only activity (unship, revert) doesn't make someone a reviewer", () => {
    const s = summarizeWindow([row("Di (U4)", "unshipped", d("2026-10-04T12:00:00Z"))], null);
    expect(s.reviewers).toBe(0);
  });

  test("the same Slack id under a renamed label is one reviewer", () => {
    const s = summarizeWindow(
      [
        row("Ada (U1)", "approved", d("2026-10-04T10:00:00Z")),
        row("Ada L. (U1)", "approved", d("2026-10-04T11:00:00Z")),
      ],
      null,
    );
    expect(s.reviewers).toBe(1);
  });

  test("labels without an id fall back to the whole label", () => {
    const s = summarizeWindow(
      [row("Ada", "approved", d("2026-10-04T10:00:00Z")), row("Bo", "approved", d("2026-10-04T10:00:00Z"))],
      null,
    );
    expect(s.reviewers).toBe(2);
  });

  test("an empty window has zero of everything", () => {
    expect(summarizeWindow([], null)).toEqual({
      counts: { approved: 0, firstPass: 0, changes: 0, rejected: 0 },
      reviewers: 0,
    });
  });
});
