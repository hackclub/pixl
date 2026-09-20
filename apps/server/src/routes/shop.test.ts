import { describe, expect, test } from "bun:test";

process.env.JWT_SECRET ??= "test-secret";
const { regionForCountry, regionMismatch } = await import("./shop.js");

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
