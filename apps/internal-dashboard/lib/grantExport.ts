import { FUNDING_ORDER_PREFIX } from "./eligibility/policy";
import { csvCell } from "./csv";
import { grantFaceValueCents } from "./grantValue";

// Builds the CSV that HCB's "Bulk send card grants" uploader accepts
// (Cards -> Bulk send card grants). Nothing is sent from this dashboard: an
// owner downloads the file, checks it, and uploads it in HCB.
//
// Amounts are not stored on shop orders (price is pixels), so they come from
// the item's own description ("A stackable $10 grant...") or, for project
// hardware funding orders, the dollar figure in the note written when the
// grant order was created. Anything ambiguous is left out and reported as a
// problem rather than guessed: sending the wrong amount is worse than sending
// nothing.

// Column order mirrors HCB's template. Rows only fill email, amount_cents,
// purpose and instructions; the rest stay blank so HCB applies its defaults.
export const GRANT_CSV_COLUMNS = [
  "email",
  "amount_cents",
  "purpose",
  "instructions",
  "one_time_use",
  "pre_authorization_required",
  "invite_message",
  "merchant_lock",
  "category_lock",
  "keyword_lock",
  "banned_merchants",
  "banned_categories",
] as const;

export interface GrantOrderLike {
  id: number;
  user_id: string;
  item_name: string;
  quantity: number;
  note: string;
  status?: string;
  item_description?: string | null;
  claimed_by?: string;
  claimed_by_slack?: string;
  // Used by the HCB grants import to pair each grant with the order it was
  // sent for. Missing on older fixtures, so callers may omit it.
  created_at?: string | Date | null;
}

export interface GrantBuyer {
  name: string;
  email: string;
}

export interface GrantExportRow {
  orderId: number;
  status: string;
  userId: string;
  playerName: string;
  email: string;
  itemName: string;
  quantity: number;
  amountCents: number;
  purpose: string;
  instructions: string;
  claimedBy: string;
  claimedBySlack: string;
  // ISO timestamp of the order, used to pair HCB grants to the right order
  // when the same buyer has more than one grant order. Empty if unavailable.
  createdAt: string;
}

export interface GrantExportProblem {
  orderId: number;
  status: string;
  itemName: string;
  reason: string;
}

export interface GrantExport {
  rows: GrantExportRow[];
  problems: GrantExportProblem[];
  totalCents: number;
}

// A grant far above any real shop item means the description parse picked up
// the wrong number, so keep it out of the file.
export const MAX_GRANT_CENTS = 100_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const usdToCents = (raw: string): number | null => {
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return Math.round(usd * 100);
};

// Project funding grants are inserted with item_id null and a note like
// "$10.00 hardware funding grant approved with this ship, withheld from
// payout." This is the amount then withheld, kept even if the project's
// request is edited later.
export function fundingGrantCents(note: string | null | undefined): number | null {
  const match = /\$\s*(\d{1,5}(?:\.\d{1,2})?)/.exec(note ?? "");
  return match ? usdToCents(match[1]) : null;
}

const clip = (value: string, max: number) => (value.length <= max ? value : value.slice(0, max - 1).trimEnd() + "…");

export function buildGrantExport(
  orders: GrantOrderLike[],
  buyers: Map<string, GrantBuyer>,
): GrantExport {
  const rows: GrantExportRow[] = [];
  const problems: GrantExportProblem[] = [];
  let totalCents = 0;

  for (const order of orders) {
    // Postgres returns bigint ids as strings. Normalize once here so the CSV,
    // the page's funding lookup and the mark-sent form all use the same number.
    const orderId = Number(order.id);
    const funding = order.item_name.startsWith(FUNDING_ORDER_PREFIX);
    const status = order.status || "pending";
    const quantity = Math.max(1, Number(order.quantity) || 1);
    const unitCents = funding
      ? fundingGrantCents(order.note)
      : grantFaceValueCents(order.item_description, order.item_name);
    const itemName = order.item_name || "(item removed)";

    if (unitCents === null) {
      problems.push({
        orderId,
        status,
        itemName,
        reason: funding
          ? "Couldn't read the dollar amount from the funding order note."
          : "Couldn't find a single dollar amount in the shop item's description.",
      });
      continue;
    }

    const amountCents = unitCents * quantity;
    if (amountCents > MAX_GRANT_CENTS) {
      problems.push({
        orderId,
        status,
        itemName,
        reason: `$${(amountCents / 100).toFixed(2)} is over the $${(MAX_GRANT_CENTS / 100).toFixed(0)} export limit, so check the amount by hand.`,
      });
      continue;
    }

    const buyer = buyers.get(order.user_id);
    const email = (buyer?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      problems.push({
        orderId,
        status,
        itemName,
        reason: "The buyer has no valid email on file.",
      });
      continue;
    }

    const projectName = funding ? order.item_name.slice(FUNDING_ORDER_PREFIX.length).trim() : "";
    const purpose = funding
      ? "PIXL hardware funding"
      : clip(itemName, 30);
    const instructions = funding
      ? `For your PIXL project ${projectName} hardware funding (order #${order.id}).`
      : `For your PIXL shop order #${order.id}: ${quantity > 1 ? `${quantity}x ` : ""}${itemName}.`;

    const created = order.created_at ? new Date(order.created_at) : null;
    const createdAt = created && !Number.isNaN(created.getTime()) ? created.toISOString() : "";

    rows.push({
      orderId,
      status,
      userId: order.user_id,
      playerName: (buyer?.name ?? "").trim() || itemName,
      email,
      itemName,
      quantity,
      amountCents,
      purpose,
      instructions: clip(instructions, 300),
      claimedBy: (order.claimed_by ?? "").trim(),
      claimedBySlack: (order.claimed_by_slack ?? "").trim(),
      createdAt,
    });
    totalCents += amountCents;
  }

  return { rows, problems, totalCents };
}

// The page's checkboxes post ids, but the server re-reads the rows and only
// keeps matching ones. Unknown ids (or orders that just got sent) disappear
// instead of being trusted from the form.
export function selectGrantRows(rows: GrantExportRow[], ids: Iterable<number>): GrantExportRow[] {
  // Bigint ids can still arrive as strings from Postgres; compare as numbers
  // so selection works even before the export row normalization lands.
  const wanted = new Set(Array.from(ids, Number));
  return rows.filter((row) => wanted.has(Number(row.orderId)));
}

export function grantCsv(rows: GrantExportRow[]): string {
  const lines = [GRANT_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.email),
        String(row.amountCents),
        csvCell(row.purpose),
        csvCell(row.instructions),
        ...Array(GRANT_CSV_COLUMNS.length - 4).fill(""),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
