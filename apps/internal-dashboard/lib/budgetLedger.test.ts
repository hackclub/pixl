import { describe, expect, test } from "bun:test";
import { parseMoneyCents, parseBudgetDate, summarizeManualLedger, type BudgetLedgerEntry } from "./budgetLedger";

const entry = (overrides: Partial<BudgetLedgerEntry>): BudgetLedgerEntry => ({
  id: 1, direction: "expense", state: "settled", amountCents: 1000,
  label: "Hosting", note: "", occurredOn: "2026-10-25", createdBy: "OWNER",
  createdAt: "2026-10-25T00:00:00Z", voidedBy: null, voidReason: null, ...overrides,
});
describe("no-migration budget ledger", () => {
  test("accepts positive money in cents but not injection, negatives or rounding", () => {
    expect(parseMoneyCents("12.34")).toBe(1234);
    expect(parseMoneyCents("0.01")).toBe(1);
    expect(parseMoneyCents("999999.99")).toBe(99999999);
    for (const raw of ["", "0", "-1", "1.234", "1e6", "Infinity", "9999999", "1,000", "01"]) {
      expect(parseMoneyCents(raw)).toBeNull();
    }
  });
  test("rejects impossible and future actual dates", () => {
    const now = new Date("2026-10-25T15:30:00Z");
    expect(parseBudgetDate("2026-10-25", false, now)).toBe(true);
    expect(parseBudgetDate("2026-10-26", false, now)).toBe(false);
    expect(parseBudgetDate("2026-10-26", true, now)).toBe(true);
    expect(parseBudgetDate("2026-02-30", true, now)).toBe(false);
  });
  test("separates planned, settled, and voided entries and income from expense", () => {
    const sums = summarizeManualLedger([
      entry({ direction: "income", amountCents: 100000 }),
      entry({ id: 2, direction: "income", state: "planned", amountCents: 20000 }),
      entry({ id: 3, amountCents: 13000 }),
      entry({ id: 4, state: "planned", amountCents: 3000 }),
      entry({ id: 5, amountCents: 5000, voidedBy: "OWNER", voidReason: "wrong" }),
    ]);
    expect(sums).toEqual({
      settledIncomeCents: 100000, settledExpenseCents: 13000,
      plannedIncomeCents: 20000, plannedExpenseCents: 3000,
    });
  });
});