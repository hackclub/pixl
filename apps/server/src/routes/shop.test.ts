import { describe, expect, test } from "bun:test";

process.env.JWT_SECRET ??= "test-secret";
const {
  regionForCountry,
  regionMismatch,
  isNewItem,
  shouldShowBuyerCount,
  scopePersonalItems,
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

  // The shape that actually reaches this function in production. pgCompat
  // reads through postgres.js, which parses timestamptz into a Date, so a
  // string-only guard here silently flags nothing as new - which is exactly
  // what shipped the first time.
  test("accepts the Date the postgres driver actually returns", () => {
    expect(isNewItem(new Date(now.getTime() - 86_400_000), now)).toBe(true);
    expect(
      isNewItem(new Date(now.getTime() - NEW_ITEM_DAYS * 86_400_000), now),
    ).toBe(false);
  });

  test("an invalid Date is never new", () => {
    expect(isNewItem(new Date("nonsense"), now)).toBe(false);
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

describe("scopePersonalItems", () => {
  const catalog = { id: 1, name: "Keyboard", reserved_user_id: null };
  const mine = { id: 2, name: "Custom tablet", reserved_user_id: "user-a" };
  const theirs = { id: 3, name: "Other custom", reserved_user_id: "user-b" };

  test("the owner sees their personal item, flagged and without the owner id", () => {
    const out = scopePersonalItems([catalog, mine, theirs], "user-a");
    expect(out.map((i) => i.id)).toEqual([1, 2]);
    expect(out[1]).toMatchObject({ id: 2, personal: true });
    expect("reserved_user_id" in out[1]).toBe(false);
  });

  test("another player never sees it", () => {
    expect(scopePersonalItems([catalog, mine], "user-c").map((i) => i.id)).toEqual([1]);
  });

  test("a signed-out visitor never sees it", () => {
    expect(scopePersonalItems([catalog, mine], null).map((i) => i.id)).toEqual([1]);
  });

  test("items from before the column existed (no key) stay in the catalog", () => {
    expect(scopePersonalItems([{ id: 9, name: "Old" }], null)).toHaveLength(1);
  });
});
