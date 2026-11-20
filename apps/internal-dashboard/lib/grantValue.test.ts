import { describe, expect, test } from "bun:test";
import { grantFaceValueCents, grantOrderFaceCents } from "./grantValue";

describe("grant face value", () => {
  test("reads a single dollar amount from the description", () => {
    expect(grantFaceValueCents("A stackable $12 grant to register a domain.")).toBe(1200);
    expect(grantFaceValueCents("A $50 grant for CPU upgrades only.")).toBe(5000);
    expect(grantFaceValueCents("A $10 grant for AI credits for the provider of your choice.")).toBe(1000);
  });
  test("handles cents and spacing", () => {
    expect(grantFaceValueCents("A $12.50 grant")).toBe(1250);
    expect(grantFaceValueCents("A $ 12 grant")).toBe(1200);
  });
  test("refuses descriptions with no amount or several different amounts", () => {
    expect(grantFaceValueCents("A grant for hardware.")).toBeNull();
    expect(grantFaceValueCents(null)).toBeNull();
    expect(grantFaceValueCents("A $10 grant, or $20 if you need more.")).toBeNull();
  });
  test("repeated mentions of the same amount are fine", () => {
    expect(grantFaceValueCents("A $10 grant. Yes, $10.")).toBe(1000);
  });
});

describe("grant order face value", () => {
  test("multiplies the item's whole-dollar face value by quantity", () => {
    expect(
      grantOrderFaceCents({
        quantity: 2,
        item_category: "grants",
        item_description: "A $10 grant for AI credits for the provider of your choice.",
      }),
    ).toBe(2000);
  });
  test("only applies to the grants category", () => {
    expect(
      grantOrderFaceCents({ quantity: 1, item_category: "tech", item_description: "A $10 grant." }),
    ).toBeNull();
    expect(grantOrderFaceCents({ quantity: 1, item_category: null, item_description: "A $10 grant." })).toBeNull();
  });
  test("returns null when the description cannot be read, so callers keep the pixel budget", () => {
    expect(grantOrderFaceCents({ quantity: 1, item_category: "grants", item_description: "A grant." })).toBeNull();
    expect(grantOrderFaceCents({ quantity: 1, item_category: "grants", item_description: null })).toBeNull();
  });
  test("treats a missing or zero quantity as one", () => {
    expect(grantOrderFaceCents({ item_category: "grants", item_description: "A $20 grant." })).toBe(2000);
    expect(grantOrderFaceCents({ quantity: 0, item_category: "grants", item_description: "A $20 grant." })).toBe(2000);
  });
});
