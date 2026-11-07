import { describe, expect, test } from "bun:test";
import { submissionsClosedFor } from "./submissionDeadline.js";

const deadline = new Date("2026-11-20T23:59:59Z");
const before = new Date("2026-11-20T12:00:00Z");
const after = new Date("2026-11-21T00:00:01Z");

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
    expect(submissionsClosedFor({ status: "draft", first_shipped_at: "2026-10-01T00:00:00Z", shipped_at: null }, after, deadline)).toBe(true);
  });

  test("allows one resubmit for needs_changes submitted before the deadline", () => {
    const p = { status: "needs_changes", first_shipped_at: "2026-11-01T00:00:00Z", shipped_at: "2026-11-10T00:00:00Z" };
    expect(submissionsClosedFor(p, after, deadline)).toBe(false);
  });

  test("refuses a second post-deadline resubmit", () => {
    const p = { status: "needs_changes", first_shipped_at: "2026-11-01T00:00:00Z", shipped_at: "2026-11-22T00:00:00Z" };
    expect(submissionsClosedFor(p, after, deadline)).toBe(true);
  });

  test("refuses a rejected project even if it looks like needs_changes", () => {
    const p = { status: "needs_changes", rejected_at: "2026-11-15T00:00:00Z", first_shipped_at: "2026-11-01T00:00:00Z", shipped_at: "2026-11-10T00:00:00Z" };
    expect(submissionsClosedFor(p, after, deadline)).toBe(true);
  });
});
