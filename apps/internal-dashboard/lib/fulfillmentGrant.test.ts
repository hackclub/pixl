import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GRANT_FULFILLMENT_PAYOUT_PIXELS,
  ITEM_FULFILLMENT_PAYOUT_PIXELS,
  fulfillmentPayoutPixels,
  isGrantOrder,
  usesGrantFlow,
} from "./fulfillmentGrant";

describe("grant orders", () => {
  test("an order is a grant by item category or by the converted flag", () => {
    expect(isGrantOrder({ item_category: "grants" })).toBe(true);
    expect(isGrantOrder({ item_category: "other", is_grant: true })).toBe(true);
    expect(isGrantOrder({ item_category: "tech", is_grant: false })).toBe(false);
    expect(isGrantOrder({})).toBe(false);
    expect(isGrantOrder({ item_category: null, is_grant: null })).toBe(false);
  });

  test("the fulfillment payout is 2 pixels for a grant and 6 for any other item", () => {
    expect(GRANT_FULFILLMENT_PAYOUT_PIXELS).toBe(2);
    expect(ITEM_FULFILLMENT_PAYOUT_PIXELS).toBe(6);
    expect(fulfillmentPayoutPixels({ item_category: "grants" })).toBe(2);
    expect(fulfillmentPayoutPixels({ is_grant: true })).toBe(2);
    expect(fulfillmentPayoutPixels({ item_category: "tech" })).toBe(6);
    expect(fulfillmentPayoutPixels({})).toBe(6);
  });

  test("only new, claimed and finished grants use the short flow, in-flight item stages keep the old controls", () => {
    const g = { item_category: "grants" };
    for (const status of ["pending", "claimed", "done"]) expect(usesGrantFlow({ ...g, status })).toBe(true);
    for (const status of ["ordered", "credited", "shipped"]) expect(usesGrantFlow({ ...g, status })).toBe(false);
    expect(usesGrantFlow({ item_category: "tech", status: "claimed" })).toBe(false);
  });
});

// actions.ts is a "use server" module full of DB calls, so these read the
// source (same approach as banPayout.test.ts) to pin the wiring.
const src = readFileSync(join(import.meta.dir, "../app/actions.ts"), "utf8");
function body(name: string): string {
  const start = src.indexOf(`export const ${name} = guardedAction(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport const ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("grant actions wiring", () => {
  test("sendGrant checks ownership, grant-ness and the self-dealing guard, then settles in one transaction", () => {
    const b = body("sendGrant");
    expect(b).toContain("ownsOrder(access, order.claimed_by_slack");
    expect(b).toContain("orderIsGrant(order)");
    expect(b).toContain("isOwnOrder(");
    expect(b).toContain("settleGrant(");
    expect(b).toContain("GRANT_FULFILLMENT_PAYOUT_PIXELS");
  });

  test("convertOrderToGrant only touches orders nothing has been bought for, and keeps the self-dealing guard", () => {
    const b = body("convertOrderToGrant");
    expect(b).toContain('.in("status", ["pending", "claimed"])');
    expect(b).toContain("isOwnOrder(");
  });

  test("shipOrder pays by order kind instead of a fixed amount", () => {
    const b = body("shipOrder");
    expect(b).toContain("fulfillmentPayoutPixels(");
    expect(b).not.toContain("FULFILLMENT_PAYOUT_PIXELS,");
  });
});
