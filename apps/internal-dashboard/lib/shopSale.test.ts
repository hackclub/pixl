import { describe, expect, test } from "bun:test";
import {
  parseSaleEndsInput,
  saleEndsInputValue,
  saleEndsLabel,
  saleIsActive,
} from "./shopSale";

describe("saleEndsInputValue", () => {
  test("turns a stored instant into the UTC datetime-local shape", () => {
    expect(saleEndsInputValue("2026-11-26T12:34:56.000Z")).toBe("2026-11-26T12:34");
    expect(saleEndsInputValue(new Date("2026-11-26T12:34:56.000Z"))).toBe("2026-11-26T12:34");
  });

  test("missing or unreadable values leave the input blank", () => {
    expect(saleEndsInputValue(null)).toBe("");
    expect(saleEndsInputValue("")).toBe("");
    expect(saleEndsInputValue("not a date")).toBe("");
  });
});

describe("parseSaleEndsInput", () => {
  test("interprets datetime-local as UTC", () => {
    expect(parseSaleEndsInput("2026-11-26T12:34")).toBe("2026-11-26T12:34:00.000Z");
  });

  test("blank means no end date", () => {
    expect(parseSaleEndsInput(null)).toBeNull();
    expect(parseSaleEndsInput("")).toBeNull();
    expect(parseSaleEndsInput("   ")).toBeNull();
  });

  test("an unreadable date is no end date, never an Invalid Date string", () => {
    expect(parseSaleEndsInput("tomorrow")).toBeNull();
  });
});

describe("saleEndsLabel", () => {
  test("renders an explicit UTC label", () => {
    expect(saleEndsLabel("2026-11-26T12:34:56.000Z")).toBe("2026-11-26 12:34 UTC");
  });

  test("missing values have no label", () => {
    expect(saleEndsLabel(null)).toBeNull();
    expect(saleEndsLabel("nope")).toBeNull();
  });
});

describe("saleIsActive", () => {
  const now = Date.parse("2026-11-25T12:00:00.000Z");

  test("a sale with no end date is active", () => {
    expect(saleIsActive(25, null, now)).toBe(true);
  });

  test("a future end date is active", () => {
    expect(saleIsActive(25, "2026-11-25T13:00:00.000Z", now)).toBe(true);
  });

  test("a past or exactly-now end date is over", () => {
    expect(saleIsActive(25, "2026-11-25T11:59:59.000Z", now)).toBe(false);
    expect(saleIsActive(25, "2026-11-25T12:00:00.000Z", now)).toBe(false);
  });

  test("0 or an unreadable end date is never active", () => {
    expect(saleIsActive(0, null, now)).toBe(false);
    expect(saleIsActive(25, "not a date", now)).toBe(false);
  });
});
