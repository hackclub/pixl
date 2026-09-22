import { describe, expect, test } from "bun:test";

process.env.JWT_SECRET ??= "test-secret";
const {
  regionForCountry,
  regionMismatch,
  isNewItem,
  shouldShowBuyerCount,
  NEW_ITEM_DAYS,
  BUYERS_VISIBLE_MIN,
} = await import("./shop.js");

describe("regionMismatch", () => {
  test("same region is allowed", () => {
    expect(regionMismatch("EUROPE", "EUROPE")).toBe(false);
  });

  test("different region is a mismatch", () => {
    expect(regionMismatch("EUROPE", "BANGLADESH")).toBe(true);
  });

  test("is case sensitive", () => {
    expect(regionMismatch("US", "us")).toBe(true);
  });
});

describe("regionForCountry", () => {
  test("maps address countries to shop regions", () => {
    expect(regionForCountry("US")).toBe("US");
    expect(regionForCountry("DE")).toBe("EUROPE");
    expect(regionForCountry("BD")).toBe("BANGLADESH");
    expect(regionForCountry("IN")).toBe("INDIA");
  });

  test("ignores case and surrounding whitespace", () => {
    expect(regionForCountry(" de ")).toBe("EUROPE");
  });

  test("unmapped countries fall back to US", () => {
    expect(regionForCountry("ZZ")).toBe("US");
    expect(regionForCountry("")).toBe("US");
  });
});

describe("isNewItem", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  const daysAgo = (d: number) =>
    new Date(now.getTime() - d * 86_400_000).toISOString();

  test("an item added today is new", () => {
    expect(isNewItem(daysAgo(0), now)).toBe(true);
  });

  test("an item added inside the window is new", () => {
    expect(isNewItem(daysAgo(NEW_ITEM_DAYS - 1), now)).toBe(true);
  });

  test("an item exactly at the window is no longer new", () => {
    expect(isNewItem(daysAgo(NEW_ITEM_DAYS), now)).toBe(false);
  });

  // The bulk catalog imports (migrations 0047/0048/0051) are all far older
  // than the window - this is the case that keeps the shop from being one
  // giant wall of NEW tags.
  test("the long-standing catalog is not new", () => {
    expect(isNewItem("2026-08-19T10:00:00Z", now)).toBe(false);
  });

  test("a missing or unparseable created_at is never new", () => {
    expect(isNewItem(null, now)).toBe(false);
    expect(isNewItem("", now)).toBe(false);
    expect(isNewItem("not a date", now)).toBe(false);
    expect(isNewItem(undefined, now)).toBe(false);
  });
});

describe("shouldShowBuyerCount", () => {
  test("hides counts below the threshold", () => {
    expect(shouldShowBuyerCount(0)).toBe(false);
    expect(shouldShowBuyerCount(BUYERS_VISIBLE_MIN - 1)).toBe(false);
  });

  test("shows counts at or above the threshold", () => {
    expect(shouldShowBuyerCount(BUYERS_VISIBLE_MIN)).toBe(true);
    expect(shouldShowBuyerCount(41)).toBe(true);
  });

  test("a missing count is not shown", () => {
    expect(shouldShowBuyerCount(undefined)).toBe(false);
    expect(shouldShowBuyerCount(null)).toBe(false);
  });
});
