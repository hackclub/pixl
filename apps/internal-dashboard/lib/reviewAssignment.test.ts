import { describe, expect, test } from "bun:test";
import {
  ASSIGNMENT_REMIND_AFTER_MS,
  ASSIGNMENT_WINDOW_MS,
  assignmentClockStartMs,
  assignmentDeadlineMs,
  earnsChangesHold,
  isAssignmentOverdue,
  lockedForViewer,
  needsAssignmentReminder,
  openableQueueIds,
  type QueueRowLike,
} from "./reviewAssignment";

const T0 = Date.parse("2026-10-20T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

// Assigned at T0, maker re-shipped 2 hours later.
const reshipped = {
  status: "shipped",
  assigned_reviewer_slack_id: "UAAA",
  assigned_at: iso(T0),
  shipped_at: iso(T0 + 2 * HOUR),
};

describe("assignment window", () => {
  test("the 3 days start at the re-ship, not at the changes request", () => {
    expect(assignmentClockStartMs(reshipped)).toBe(T0 + 2 * HOUR);
    expect(assignmentDeadlineMs(reshipped)).toBe(T0 + 2 * HOUR + ASSIGNMENT_WINDOW_MS);
  });

  test("with no re-ship yet it counts from the assignment", () => {
    const p = { ...reshipped, shipped_at: iso(T0 - 5 * HOUR) };
    expect(assignmentClockStartMs(p)).toBe(T0);
  });

  test("nothing is due without an assignee or outside first pass", () => {
    expect(assignmentClockStartMs({ ...reshipped, assigned_reviewer_slack_id: "" })).toBeNull();
    expect(assignmentClockStartMs({ ...reshipped, status: "needs_changes" })).toBeNull();
  });

  test("overdue exactly at 72 hours after the re-ship", () => {
    const start = T0 + 2 * HOUR;
    expect(isAssignmentOverdue(reshipped, start + ASSIGNMENT_WINDOW_MS - 1)).toBe(false);
    expect(isAssignmentOverdue(reshipped, start + ASSIGNMENT_WINDOW_MS)).toBe(true);
  });

  test("a reminder is due after a day, once per window, and never when overdue", () => {
    const start = T0 + 2 * HOUR;
    expect(needsAssignmentReminder(reshipped, start + ASSIGNMENT_REMIND_AFTER_MS - 1)).toBe(false);
    expect(needsAssignmentReminder(reshipped, start + ASSIGNMENT_REMIND_AFTER_MS)).toBe(true);
    const sent = { ...reshipped, assignment_reminded_at: iso(start + ASSIGNMENT_REMIND_AFTER_MS) };
    expect(needsAssignmentReminder(sent, start + 2 * ASSIGNMENT_REMIND_AFTER_MS)).toBe(false);
    expect(needsAssignmentReminder(reshipped, start + ASSIGNMENT_WINDOW_MS)).toBe(false);
    // A reminder from an earlier window doesn't count for the new one.
    const old = { ...reshipped, assignment_reminded_at: iso(T0 - 10 * HOUR) };
    expect(needsAssignmentReminder(old, start + ASSIGNMENT_REMIND_AFTER_MS)).toBe(true);
  });
});

describe("lockedForViewer", () => {
  const now = T0 + 5 * HOUR;
  test("reserved for the assignee, open to them and to owners", () => {
    expect(lockedForViewer(reshipped, "UBBB", false, now)).toBe(true);
    expect(lockedForViewer(reshipped, "UAAA", false, now)).toBe(false);
    expect(lockedForViewer(reshipped, "UBBB", true, now)).toBe(false);
  });

  test("goes back to everyone once the window is over", () => {
    const late = T0 + 2 * HOUR + ASSIGNMENT_WINDOW_MS + 1;
    expect(lockedForViewer(reshipped, "UBBB", false, late)).toBe(false);
  });

  test("an unassigned project is open", () => {
    expect(lockedForViewer({ status: "shipped" }, "UBBB", false, now)).toBe(false);
  });
});

describe("openableQueueIds", () => {
  const rows = (n: number, extra: Partial<QueueRowLike> = {}): QueueRowLike[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, status: "shipped", ...extra }));
  const now = T0 + 5 * HOUR;

  test("a plain reviewer gets the first 15 only", () => {
    const open = openableQueueIds(rows(40), "UBBB", false, now);
    expect([...open].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  test("owners can open everything", () => {
    expect(openableQueueIds(rows(40), "UBBB", true, now).size).toBe(40);
  });

  test("rows reserved for others, held, own or claimed don't use up a slot", () => {
    const list: QueueRowLike[] = [
      { id: 1, status: "shipped", assigned_reviewer_slack_id: "UAAA", assigned_at: iso(T0), shipped_at: iso(T0 + HOUR) },
      { id: 2, status: "shipped", hold_at: iso(T0) },
      { id: 3, status: "shipped", own: true },
      { id: 4, status: "shipped", claimedBy: "UCCC" },
      ...Array.from({ length: 20 }, (_, i) => ({ id: 10 + i, status: "shipped" })),
    ];
    const open = openableQueueIds(list, "UBBB", false, now);
    expect(open.has(1) || open.has(2) || open.has(3) || open.has(4)).toBe(false);
    expect(open.size).toBe(15);
    expect(open.has(10)).toBe(true);
    expect(open.has(24)).toBe(true);
    expect(open.has(25)).toBe(false);
  });

  test("a project assigned to the viewer is open wherever it sits in the queue", () => {
    const list: QueueRowLike[] = [
      ...rows(30),
      { id: 99, status: "shipped", assigned_reviewer_slack_id: "UBBB", assigned_at: iso(T0), shipped_at: iso(T0 + HOUR) },
    ];
    const open = openableQueueIds(list, "UBBB", false, now);
    expect(open.has(99)).toBe(true);
    expect(open.size).toBe(16);
  });

  test("an overdue assignment is just a normal row again", () => {
    const late = T0 + HOUR + ASSIGNMENT_WINDOW_MS + 1;
    const list: QueueRowLike[] = [
      { id: 1, status: "shipped", assigned_reviewer_slack_id: "UAAA", assigned_at: iso(T0), shipped_at: iso(T0 + HOUR) },
    ];
    expect(openableQueueIds(list, "UBBB", false, late).has(1)).toBe(true);
  });
});

describe("earnsChangesHold", () => {
  test("only the first request for changes earns the held pixel", () => {
    expect(earnsChangesHold([])).toBe(true);
    expect(earnsChangesHold([{ verdict: "needs_changes", status: "pending" }])).toBe(false);
    expect(earnsChangesHold([{ verdict: "needs_changes", status: "paid" }])).toBe(false);
  });

  test("a forfeited one doesn't count, so the next reviewer earns it", () => {
    expect(earnsChangesHold([{ verdict: "needs_changes", status: "voided" }])).toBe(true);
    expect(earnsChangesHold([{ verdict: "first_pass_approved", status: "paid" }])).toBe(true);
  });
});
