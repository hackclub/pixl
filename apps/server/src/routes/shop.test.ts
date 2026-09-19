import { describe, expect, test } from "bun:test";
import { regionMismatch } from "./shop.js";

// shop_items are split per region so pricing/fulfillment can differ by where
// a player actually lives (0063_shop_items_region.sql, 0064_users_region.sql).
// POST /api/shop/buy/:id used to buy whatever item id it was given at that
// item's own price, with no check that the item's region matched the buyer's
// own region (users.region, freely self-service via POST /api/shop/region -
// see 0064's own comment that it's not tied to a real address). This let a
// player switch their listed region to wherever a physical item was cheapest
// and buy it there while still shipping to their real, unrelated address.
describe("regionMismatch (shop region-price-arbitrage fix)", () => {
  test("same region: not a mismatch, purchase allowed", () => {
    expect(regionMismatch("EUROPE", "EUROPE")).toBe(false);
  });

  test("buyer's region is cheaper than the item's own region: rejected", () => {
    // The actual attack this closes: a US-address player switches their
    // listed region to BANGLADESH (a self-service, unvalidated choice) and
    // tries to buy a EUROPE-region-priced item at Bangladesh pricing.
    expect(regionMismatch("EUROPE", "BANGLADESH")).toBe(true);
  });

  test("is case- and value-sensitive - no normalization slips a mismatch through", () => {
    expect(regionMismatch("US", "us")).toBe(true);
  });
});
