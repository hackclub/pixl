import { describe, expect, test } from "bun:test";
import { ageLabel, foldOrderCounts, lastUpdated } from "./fulfillmentView";

const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("ageLabel", () => {
  test("shows minutes under an hour", () => {
    expect(ageLabel("2026-10-15T11:30:00Z", NOW)).toBe("30m ago");
  });
  test("shows hours under a day", () => {
    expect(ageLabel("2026-10-15T05:00:00Z", NOW)).toBe("7h ago");
  });
  test("shows days beyond that", () => {
    expect(ageLabel("2026-10-12T12:00:00Z", NOW)).toBe("3d ago");
  });
  test("returns empty for missing or invalid dates", () => {
    expect(ageLabel(null, NOW)).toBe("");
    expect(ageLabel("nope", NOW)).toBe("");
  });
  test("never goes negative for future timestamps", () => {
    expect(ageLabel("2026-10-15T13:00:00Z", NOW)).toBe("0m ago");
  });
});

describe("lastUpdated", () => {
  const base = {
    created_at: "2026-10-01T00:00:00Z",
    claimed_at: null,
    ordered_at: null,
    credited_at: null,
    shipped_at: null,
    done_at: null,
    flagged_at: null,
    fulfilled_at: null,
  };
  test("falls back to creation for an unclaimed order", () => {
    expect(lastUpdated(base)).toBe(base.created_at);
  });
  test("later stage timestamps win", () => {
    const o = { ...base, ordered_at: "2026-10-02T00:00:00Z", credited_at: "2026-10-03T00:00:00Z" };
    expect(lastUpdated(o)).toBe("2026-10-03T00:00:00Z");
  });
  test("compares times, not pipeline order", () => {
    const o = { ...base, ordered_at: "2026-10-05T00:00:00Z", shipped_at: "2026-10-04T00:00:00Z" };
    expect(lastUpdated(o)).toBe("2026-10-05T00:00:00Z");
  });
  test("a recent flag on an old order is the update", () => {
    const flagged = "2026-10-15T11:55:00Z";
    const stamp = lastUpdated({ ...base, flagged_at: flagged });
    expect(stamp).toBe(flagged);
    expect(ageLabel(stamp, NOW)).toBe("5m ago");
  });
  test("a cancellation timestamp counts", () => {
    expect(lastUpdated({ ...base, fulfilled_at: "2026-10-09T00:00:00Z" })).toBe("2026-10-09T00:00:00Z");
  });
  test("malformed timestamps are ignored", () => {
    expect(lastUpdated({ ...base, ordered_at: "garbage", flagged_at: "" })).toBe(base.created_at);
  });
  test("an all-invalid row does not crash and ageLabel stays blank", () => {
    const stamp = lastUpdated({ ...base, created_at: "nope" });
    expect(ageLabel(stamp, NOW)).toBe("");
  });
  test("a future timestamp is clamped by ageLabel", () => {
    const stamp = lastUpdated({ ...base, shipped_at: "2026-10-16T00:00:00Z" });
    expect(ageLabel(stamp, NOW)).toBe("0m ago");
  });
});

describe("foldOrderCounts", () => {
  test("sums per status, flagged across statuses and the total", () => {
    const c = foldOrderCounts([
      { status: "pending", n: 5, flagged: 1 },
      { status: "ordered", n: 3, flagged: 2 },
      { status: "cancelled", n: 1, flagged: 0 },
    ]);
    expect(c).toEqual({ pending: 5, claimed: 0, ordered: 3, credited: 0, shipped: 0, done: 0, cancelled: 1, flagged: 3, all: 9 });
  });
  test("ignores unknown statuses in the per-status buckets but still counts them in all", () => {
    const c = foldOrderCounts([{ status: "weird", n: 2, flagged: 0 }]);
    expect(c.all).toBe(2);
    expect(c.pending).toBe(0);
  });
  test("empty input is all zeros", () => {
    expect(foldOrderCounts([]).all).toBe(0);
  });
});
