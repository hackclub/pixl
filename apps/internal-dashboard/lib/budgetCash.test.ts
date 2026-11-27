import { describe, expect, test } from "bun:test";
import { loadCash, summarizeCash, type CashTransaction } from "./budgetCash";

const row = (id: string, amount: number, memo: string, extra = {}): CashTransaction => ({ id, amount_cents: amount, memo, date: "2026-11-03", pending: false, tags: [], ...extra });
const mockFetch = (bodies: unknown[]) => {
  let index = 0;
  return (async () => Response.json(bodies[index++])) as typeof fetch;
};
const org = { slug: "ysws-pixl", transparent: true, balances: { balance_cents: 500 } };

describe("HCB budget accounting", () => {
  test("pending debits, grants and fines are counted once in cash", () => {
    const cash = summarizeCash(500, [row("1", 1000, "Funding"), row("2", -200, "Grant to A"), row("3", -300, "Transfer to Fines", { pending: true })], "2026-11-03T00:00:00Z");
    expect(cash.incomingCents).toBe(1000);
    expect(cash.outgoingCents).toBe(500);
    expect(cash.pendingCents).toBe(-300);
    expect(cash.reconciled).toBe(true);
    expect(cash.spending).toContainEqual({ label: "Fines", cents: 300 });
  });
  test("incomplete ledger cannot pass the balance check", () => {
    expect(summarizeCash(500, [row("1", 1000, "Funding")], "now").reconciled).toBe(false);
  });
  test("valid API data reconciles including pending entries", async () => {
    const cash = await loadCash(mockFetch([org, [row("1", 1000, "Funding"), row("2", -500, "Shop", { pending: true })]]));
    expect(cash.balanceCents).toBe(500);
    expect(cash.reconciled).toBe(true);
    expect(cash.transactionCount).toBe(2);
  });
  test("reads beyond the first 100 transactions", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => row(String(i), 10, "Funding"));
    const cash = await loadCash(mockFetch([org, firstPage, [row("100", -500, "Purchase")]]));
    expect(cash.transactionCount).toBe(101);
    expect(cash.reconciled).toBe(true);
  });
  test("rejects missing balances instead of substituting zero", async () => {
    await expect(loadCash(mockFetch([{ ...org, balances: {} }]))).rejects.toThrow();
  });
  test("rejects duplicate transaction IDs instead of double counting", async () => {
    await expect(loadCash(mockFetch([org, [row("1", 100, "A"), row("1", 100, "A")]]))).rejects.toThrow("Incomplete");
  });
  test("fetch failure does not become zero cash", async () => {
    await expect(loadCash((async () => new Response("error", { status: 503 })) as typeof fetch)).rejects.toThrow("unavailable");
  });
});
