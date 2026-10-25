import { describe, expect, test } from "bun:test";
import { BUDGET_CATEGORIES, parseUsdToCents, summarizeBudget } from "./budgetMath";

describe("budget accounting", () => {
  test("accepts positive USD with at most two decimals", () => {
    expect(parseUsdToCents("12.30")).toBe(1230);
    expect(parseUsdToCents("0.01")).toBe(1);
    expect(parseUsdToCents("1")).toBe(100);
    for (const raw of ["0", "-1", "1.999", "1e6", "Infinity", "01", "1,000", ""]) {
      expect(parseUsdToCents(raw)).toBeNull();
    }
  });
  test("does not treat pending or voided money as actual cash, or double count pixels", () => {
    const s = summarizeBudget([
      { direction: "income", state: "settled", amountCents: 50000, voided: false },
      { direction: "income", state: "planned", amountCents: 30000, voided: false },
      { direction: "expense", state: "settled", amountCents: 12000, voided: false },
      { direction: "expense", state: "planned", amountCents: 5000, voided: false },
      { direction: "expense", state: "settled", amountCents: 1000, voided: true },
    ], 8000);
    expect(s).toEqual({
      incomeCents: 50000,
      manualExpensesCents: 12000,
      shopSpentCents: 8000,
      totalExpensesCents: 20000,
      recordedNetCents: 30000,
      plannedIncomeCents: 30000,
      plannedExpensesCents: 5000,
      hasRecordedIncome: true,
    });
  });
  test("does not claim actual profit when funding has not been recorded", () => {
    const s = summarizeBudget([], 1200);
    expect(s.recordedNetCents).toBe(-1200);
    expect(s.hasRecordedIncome).toBe(false);
  });
  test("every category has a recognized direction", () => {
    expect(Object.values(BUDGET_CATEGORIES).every((v) => v.direction === "income" || v.direction === "expense")).toBe(true);
  });
});
