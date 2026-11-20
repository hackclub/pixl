import { describe, expect, test } from "bun:test";
import { submissionsClosedFor } from "./submissionDeadline.js";

const deadline = new Date("2026-11-20T23:59:59Z");
const before = new Date("2026-11-20T12:00:00Z");
const after = new Date("2026-11-21T00:00:01Z");
const lateInWindow = new Date("2026-11-22T23:00:00Z"); // deadline + ~47h
const afterWindow = new Date("2026-11-23T00:00:01Z"); // deadline + 48h + 2s
const lastDay = "2026-11-20T10:00:00Z"; // inside the 24h before the deadline
const tooEarly = "2026-11-19T20:00:00Z"; // more than 24h before the deadline

const needsChanges = { status: "needs_changes", first_shipped_at: "2026-11-01T00:00:00Z", shipped_at: "2026-11-10T00:00:00Z" };

describe("submissionsClosedFor", () => {
  test("never closes before the deadline", () => {
    expect(submissionsClosedFor({ status: "draft" }, before, deadline)).toBe(false);
    expect(submissionsClosedFor({ status: "approved" }, before, deadline)).toBe(false);
  });

  test("refuses first submissions and approved updates after the deadline", () => {
    expect(submissionsClosedFor({ status: "draft" }, after, deadline)).toBe(true);
    expect(submissionsClosedFor({ status: "approved", first_shipped_at: "2026-10-01T00:00:00Z" }, after, deadline)).toBe(true);
  });

  test("refuses an unshipped draft that was shipped once before", () => {
    expect(submissionsClosedFor({ status: "draft", first_shipped_at: "2026-10-01T00:00:00Z", shipped_at: null }, after, deadline, lastDay)).toBe(true);
  });

  test("allows one resubmit when changes were requested in the last 24h", () => {
    expect(submissionsClosedFor(needsChanges, after, deadline, lastDay)).toBe(false);
    expect(submissionsClosedFor(needsChanges, lateInWindow, deadline, lastDay)).toBe(false);
  });

  test("includes both edges of the 24h range", () => {
    expect(submissionsClosedFor(needsChanges, after, deadline, "2026-11-19T23:59:59Z")).toBe(false);
    expect(submissionsClosedFor(needsChanges, after, deadline, deadline)).toBe(false);
  });

  test("refuses changes requested earlier than 24h before the deadline", () => {
    expect(submissionsClosedFor(needsChanges, after, deadline, tooEarly)).toBe(true);
    expect(submissionsClosedFor(needsChanges, after, deadline, "2026-11-19T23:59:58Z")).toBe(true);
  });

  test("refuses changes requested after the deadline", () => {
    expect(submissionsClosedFor(needsChanges, after, deadline, "2026-11-21T05:00:00Z")).toBe(true);
  });

  test("refuses when no changes-requested time is known", () => {
    expect(submissionsClosedFor(needsChanges, after, deadline)).toBe(true);
    expect(submissionsClosedFor(needsChanges, after, deadline, null)).toBe(true);
  });

  test("closes the resubmit window 48h after the deadline", () => {
    expect(submissionsClosedFor(needsChanges, afterWindow, deadline, lastDay)).toBe(true);
  });

  test("refuses a second post-deadline resubmit", () => {
    const p = { ...needsChanges, shipped_at: "2026-11-22T00:00:00Z" };
    expect(submissionsClosedFor(p, lateInWindow, deadline, lastDay)).toBe(true);
  });

  test("refuses a rejected project even if it looks like needs_changes", () => {
    const p = { ...needsChanges, rejected_at: "2026-11-15T00:00:00Z" };
    expect(submissionsClosedFor(p, after, deadline, lastDay)).toBe(true);
  });
});
