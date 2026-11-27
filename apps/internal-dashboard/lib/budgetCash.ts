import { unstable_cache } from "next/cache";

const API = "https://hcb.hackclub.com/api/v3/organizations/ysws-pixl";
export const HCB_URL = "https://hcb.hackclub.com/ysws-pixl/transactions";
export interface CashTransaction {
  id: string;
  amount_cents: number;
  memo: string;
  date: string;
  pending: boolean;
  tags: { label: string }[];
}
export interface CashLedger {
  balanceCents: number;
  incomingCents: number;
  outgoingCents: number;
  pendingCents: number;
  reconciled: boolean;
  transactionCount: number;
  fetchedAt: string;
  spending: { label: string; cents: number }[];
}

export function summarizeCash(balanceCents: number, rows: CashTransaction[], fetchedAt: string): CashLedger {
  const groups = new Map<string, number>();
  let incomingCents = 0, outgoingCents = 0, pendingCents = 0;
  for (const row of rows) {
    if (row.pending) pendingCents += row.amount_cents;
    if (row.amount_cents >= 0) { incomingCents += row.amount_cents; continue; }
    outgoingCents -= row.amount_cents;
    const tags = row.tags.map((tag) => tag.label.toLowerCase());
    const label = /to Fines\b/i.test(row.memo) ? "Fines"
      : /Security Bounty/i.test(row.memo) ? "Security bounties"
      : tags.includes("contractors") ? "Contractors"
      : /^(Grant to|Topup of grant)/i.test(row.memo) ? "Grants & top-ups"
      : tags.some((tag) => /fulfil+ment/.test(tag)) ? "Fulfilment"
      : /to (YSWS - Budget|Hack Club HQ)/i.test(row.memo) ? "Budget transfers"
      : "Other expenses";
    groups.set(label, (groups.get(label) ?? 0) - row.amount_cents);
  }
  return { balanceCents, incomingCents, outgoingCents, pendingCents,
    reconciled: incomingCents - outgoingCents === balanceCents,
    transactionCount: rows.length, fetchedAt,
    spending: [...groups].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents) };
}

export async function loadCash(fetcher: typeof fetch = fetch): Promise<CashLedger> {
  const signal = AbortSignal.timeout(12_000);
  const read = async (url: string): Promise<unknown> => {
    const response = await fetcher(url, { cache: "no-store", signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("HCB is unavailable");
    return response.json();
  };
  const org = await read(API) as { slug?: string; transparent?: boolean; balances?: { balance_cents?: number } };
  const balance = org.balances?.balance_cents;
  if (org.slug !== "ysws-pixl" || org.transparent !== true || !Number.isSafeInteger(balance)) {
    throw new Error("HCB balance is unavailable");
  }
  const rows: CashTransaction[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const batch = await read(`${API}/transactions?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("Invalid HCB ledger");
    for (const row of batch) {
      if (typeof row.id !== "string" || seen.has(row.id) || !Number.isSafeInteger(row.amount_cents)
        || typeof row.memo !== "string" || typeof row.date !== "string" || typeof row.pending !== "boolean"
        || !Array.isArray(row.tags) || row.tags.some((tag: { label?: unknown }) => typeof tag.label !== "string")) {
        throw new Error("Incomplete HCB ledger");
      }
      seen.add(row.id);
      rows.push(row);
    }
    if (batch.length < 100) return summarizeCash(balance!, rows, new Date().toISOString());
  }
  throw new Error("HCB ledger exceeds the page limit");
}

const cachedCash = unstable_cache(() => loadCash(), ["pixl-budget-hcb-v1"], { revalidate: 60 });
export async function getBudgetCash(): Promise<CashLedger | null> {
  try { return await cachedCash(); }
  catch { return null; }
}
