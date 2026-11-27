import { buyerDetailsByUserId, listGrantOrdersForExport, type ShopOrderRow } from "./db";
import { buildGrantExport, type GrantExport } from "./grantExport";
import { evaluateOrders } from "./eligibility/evidence";
import type { EligibilityResult } from "./eligibility/engine";
import { eligibilityRisk, parseEligibilityFilter } from "./eligibility/format";
import { shipsProvider } from "./eligibility/ships";

// Two views of "needs a grant":
// - pending: nobody has claimed the order, so no grant can have been sent yet.
//   This is the safe default for a bulk upload.
// - open: also include claimed grants that have not been sent yet. Useful for
//   picking up work in progress, but a grant may already have been sent by
//   hand, so the page warns about it.
export type GrantScope = "pending" | "open";

export const GRANT_SCOPE_LABEL: Record<GrantScope, string> = {
  pending: "Unclaimed",
  open: "Unclaimed + claimed",
};

const GRANT_SCOPE_STATUSES: Record<GrantScope, string[]> = {
  pending: ["pending"],
  open: ["pending", "claimed"],
};

export function parseGrantScope(value: string | null | undefined): GrantScope {
  return value === "open" ? "open" : "pending";
}

async function loadOrdersAndBuyers(scope: GrantScope) {
  const orders = await listGrantOrdersForExport(GRANT_SCOPE_STATUSES[scope]);
  const buyers = await buyerDetailsByUserId(orders.map((o) => o.user_id));
  return { orders, buyers };
}

// Buyer emails are PII: only call this from an owner-gated page/route (they
// are decrypted here with the same helper the order detail view uses).
export async function loadGrantExport(scope: GrantScope): Promise<GrantExport> {
  const { orders, buyers } = await loadOrdersAndBuyers(scope);
  return buildGrantExport(orders, buyers);
}

// Funding coverage for the export page. Use the same live Airtable check as
// the fulfillment order detail, not the queue's cached badge: otherwise an
// order can read "Unverified" here while its detail page, after a live lookup,
// says "Covered". The 5-minute Airtable cache keeps the batch from hammering
// the API, and a failure still falls back to "Not loaded" without hiding the CSV.
async function loadGrantFunding(orders: ShopOrderRow[]): Promise<Map<number, EligibilityResult>> {
  if (orders.length === 0) return new Map();
  try {
    return await evaluateOrders(orders, { liveAirtable: true, ships: await shipsProvider().get() });
  } catch (e) {
    console.error("grant export funding", (e as Error).message);
    return new Map();
  }
}

export interface GrantExportPageData {
  data: GrantExport;
  funding: Map<number, EligibilityResult>;
}

export async function loadGrantExportPage(scope: GrantScope): Promise<GrantExportPageData> {
  const { orders, buyers } = await loadOrdersAndBuyers(scope);
  const data = buildGrantExport(orders, buyers);
  const funding = await loadGrantFunding(orders);
  return { data, funding };
}

// The download follows the page's funding dropdown: same filter, same
// least-risk-first order. The CSV's `totalCents` is recalculated for the
// filtered rows; problems are unchanged because they were never in the file.
export async function loadGrantExportFiltered(
  scope: GrantScope,
  fundingParam: string | null | undefined,
): Promise<GrantExport> {
  const { data, funding } = await loadGrantExportPage(scope);
  const filter = parseEligibilityFilter(fundingParam ?? "");
  const notLoaded = fundingParam === "not_loaded";

  const rows = data.rows
    .filter((row) => {
      if (notLoaded) return !funding.get(row.orderId);
      if (filter) return funding.get(row.orderId)?.status === filter;
      return true;
    })
    .sort((a, b) =>
      eligibilityRisk(funding.get(a.orderId)?.status) -
        eligibilityRisk(funding.get(b.orderId)?.status) ||
      (a.createdAt || "").localeCompare(b.createdAt || "") ||
      a.orderId - b.orderId,
    );

  return {
    ...data,
    rows,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}
