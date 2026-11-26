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
  approvedTrialIds,
  isReviewer,
  reviewGrantLockNote,
  saleIsActive,
} = await import("./shop.js");

describe("saleIsActive", () => {
  const now = Date.parse("2026-11-25T12:00:00.000Z");
  const sale = (discount_percent: unknown, discount_ends_at: unknown) => ({ discount_percent, discount_ends_at });

  test("a sale without an end date runs until cleared", () => {
    expect(saleIsActive(sale(20, null), now)).toBe(true);
  });

  test("a future end date keeps the sale running", () => {
    expect(saleIsActive(sale(20, "2026-11-25T13:00:00.000Z"), now)).toBe(true);
    expect(saleIsActive(sale(20, new Date("2026-11-25T13:00:00.000Z")), now)).toBe(true);
  });

  test("a past or exactly-now end date ends the sale", () => {
    expect(saleIsActive(sale(20, "2026-11-25T11:59:59.000Z"), now)).toBe(false);
    expect(saleIsActive(sale(20, "2026-11-25T12:00:00.000Z"), now)).toBe(false);
  });

  test("0% or an unreadable end date is never an active sale", () => {
    expect(saleIsActive(sale(0, null), now)).toBe(false);
    expect(saleIsActive(sale(20, "not a date"), now)).toBe(false);
  });
});

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

describe("approvedTrialIds (Trial-gated unlocks)", () => {
  const p = (id: number, sidequest_id: number | null, status: string, banned_at: string | null = null) => ({ id, sidequest_id, status, banned_at });

  test("a project only in the review queue (unshippable) unlocks nothing", () => {
    expect([...approvedTrialIds([p(1, 5, "shipped"), p(2, 6, "second_review")], [])]).toEqual([]);
  });

  test("an approved project unlocks its Trial", () => {
    expect([...approvedTrialIds([p(1, 5, "approved")], [])]).toEqual([5]);
  });

  test("approved at some point still counts after an update ship or a needs_changes", () => {
    const approvals = [{ project_id: 1, amount: 120 }];
    expect([...approvedTrialIds([p(1, 5, "needs_changes")], approvals)]).toEqual([5]);
    expect([...approvedTrialIds([p(1, 5, "shipped")], approvals)]).toEqual([5]);
  });

  test("a reverted approval or a ban takes it away", () => {
    expect([...approvedTrialIds([p(1, 5, "draft")], [{ project_id: 1, amount: 120 }, { project_id: 1, amount: -120 }])]).toEqual([]);
    expect([...approvedTrialIds([p(1, 5, "approved", "2026-10-01")], [{ project_id: 1, amount: 120 }])]).toEqual([]);
  });
});

describe("reviewGrantLockNote", () => {
  const base = { reviews: 0, earned: 0, claimed: 0, available: 0, next_at: 150, to_go: 150 };

  test("tells a signed-out or errored lookup to review projects", () => {
    expect(reviewGrantLockNote(null)).toBe("Reviewers unlock this by reviewing projects.");
  });

  test("shows how far they are from the next grant", () => {
    expect(reviewGrantLockNote({ ...base, reviews: 118, to_go: 32 })).toBe(
      "Review 32 more projects to unlock the next one (118/150 reviews).",
    );
  });

  test("is singular for the last review", () => {
    expect(reviewGrantLockNote({ ...base, reviews: 149, to_go: 1 })).toBe(
      "Review 1 more project to unlock the next one (149/150 reviews).",
    );
  });

  test("says everything is claimed once past the last milestone", () => {
    expect(
      reviewGrantLockNote({ reviews: 410, earned: 4, claimed: 4, available: 0, next_at: null, to_go: null }),
    ).toBe("You've claimed every grant (410 reviews).");
  });
});

describe("isReviewer", () => {
  const base = { reviews: 0, earned: 0, claimed: 0, available: 0, next_at: 150, to_go: 150 };
  test("hides the grant from people who never reviewed", () => {
    expect(isReviewer(null)).toBe(false);
    expect(isReviewer(base)).toBe(false);
  });
  test("shows it once they have reviewed or already claimed one", () => {
    expect(isReviewer({ ...base, reviews: 1 })).toBe(true);
    expect(isReviewer({ ...base, claimed: 1 })).toBe(true);
  });
});
