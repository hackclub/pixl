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
  test("known catalog items use their explicit face value", () => {
    expect(grantFaceValueCents("A subscription for the AI provider of your choice.", "AI subscription/credits")).toBe(1000);
    expect(grantFaceValueCents("A $20 plan, or $10 a month.", "AI subscription/credits")).toBe(1000);
    expect(grantFaceValueCents("A grant for hardware.", "Hardware Grant")).toBe(1000);
    expect(grantFaceValueCents("A $12 grant.", "Hardware Grant")).toBe(1000);
    expect(grantFaceValueCents("A stackable $50 grant for CPU upgrades only.", "CPU Grant")).toBe(5000);
    expect(grantFaceValueCents("A grant with no price.", "CPU/GPU Grant")).toBe(5000);
    expect(grantFaceValueCents("A grant with no price.", "Smolhaj")).toBe(1500);
    // The old description said $12; the current grant is $10.
    expect(grantFaceValueCents("A stackable $12 grant to register a domain for your project.", "Domain Grant")).toBe(1000);
  });
  test("reads a dollar sign after the number, as in Food Grant's description", () => {
    expect(grantFaceValueCents("One-time 20$ grant, get it with a chapter 3 Pixl Cafe trial", "Food Grant")).toBe(2000);
    expect(grantFaceValueCents("A grant worth 12$ or 12$", "Mystery Grant")).toBe(1200);
    expect(grantFaceValueCents("A 10$ grant, or 20$ if you need more", "Mystery Grant")).toBeNull();
  });
  test("falls back to an amount embedded in the item name", () => {
    expect(grantFaceValueCents("A grant with no price.", "10$ printing grant")).toBe(1000);
    expect(grantFaceValueCents("A grant with no price.", "15$ HQ shipping grant")).toBe(1500);
    expect(grantFaceValueCents("A grant with no price.", "100$ laptop grant")).toBe(10000);
    expect(grantFaceValueCents("A grant with no price.", "10$ Storage grant")).toBe(1000);
    expect(grantFaceValueCents("A grant with no price.", "Mystery Grant")).toBeNull();
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
  test("uses the known item name when the description cannot be read", () => {
    expect(
      grantOrderFaceCents({
        quantity: 2,
        item_name: "AI subscription/credits",
        item_category: "grants",
        item_description: "Pick any AI provider.",
      }),
    ).toBe(2000);
    expect(
      grantOrderFaceCents({
        quantity: 1,
        item_name: "Food Grant",
        item_category: "grants",
        item_description: "One-time 20$ grant, get it with a chapter 3 Pixl Cafe trial",
      }),
    ).toBe(2000);
  });
  test("treats a missing or zero quantity as one", () => {
    expect(grantOrderFaceCents({ item_category: "grants", item_description: "A $20 grant." })).toBe(2000);
    expect(grantOrderFaceCents({ quantity: 0, item_category: "grants", item_description: "A $20 grant." })).toBe(2000);
  });
});
