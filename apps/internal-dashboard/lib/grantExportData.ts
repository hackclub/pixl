import { buyerDetailsByUserId, listGrantOrdersForExport } from "./db";
import { buildGrantExport, type GrantExport } from "./grantExport";

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

// Buyer emails are PII: only call this from an owner-gated page/route (they
// are decrypted here with the same helper the order detail view uses).
export async function loadGrantExport(scope: GrantScope): Promise<GrantExport> {
  const orders = await listGrantOrdersForExport(GRANT_SCOPE_STATUSES[scope]);
  const buyers = await buyerDetailsByUserId(orders.map((o) => o.user_id));
  return buildGrantExport(orders, buyers);
}
