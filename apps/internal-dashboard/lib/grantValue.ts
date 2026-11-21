// Grant amounts are round dollar figures shown in the shop item's own
// description ("A stackable $10 grant to ..."). The item's pixel price is only
// an internal ceiling at the configured pixel value, so it is usually higher:
// 2x AI Credits is $20 of real money but 222 px ≈ $22.20 of shop budget.
//
// One parser for both the fulfillment budget display and the eligibility
// engine, so the order detail, the grant CSV and the funding check can never
// disagree about what a grant is worth.

const usdToCents = (raw: string): number | null => {
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return Math.round(usd * 100);
};

// Face values we know without trusting the shop copy. AI subscriptions are a
// flat $10 per unit even when the description has no dollar figure (or has
// more than one); the name is the catalog identity, so match it exactly.
// Food Grant became a one-time $20 chapter 3 reward, and its description writes
// "20$" rather than "$20". lib/eligibility/policy.ts reuses this list for the
// funding check, so the CSV and the eligibility engine cannot disagree.
export const KNOWN_ITEM_FACE_VALUES: { match: RegExp; faceValueUsd: number }[] = [
  { match: /^hardware grant$/i, faceValueUsd: 10 },
  { match: /^domain grant$/i, faceValueUsd: 10 },
  { match: /^hosting grant$/i, faceValueUsd: 10 },
  { match: /^cpu grant$/i, faceValueUsd: 50 },
  { match: /^gpu grant$/i, faceValueUsd: 50 },
  { match: /^cpu\/gpu grant$/i, faceValueUsd: 50 },
  { match: /^ram grant$/i, faceValueUsd: 50 },
  { match: /^smolhaj$/i, faceValueUsd: 15 },
  { match: /^monitor grant \(stackable\)$/i, faceValueUsd: 100 },
  { match: /^(reviewer )?food grant$/i, faceValueUsd: 20 },
  { match: /^music grant$/i, faceValueUsd: 10 },
  { match: /^art supply grant$/i, faceValueUsd: 10 },
  { match: /^soldering tools grant$/i, faceValueUsd: 10 },
  { match: /^game assets grant$/i, faceValueUsd: 10 },
  { match: /^ai subscription\/credits$/i, faceValueUsd: 10 },
  { match: /^ai credits$/i, faceValueUsd: 10 },
];

export function itemFaceValueCents(itemName: string | null | undefined): number | null {
  const name = (itemName ?? "").trim();
  if (!name) return null;
  const rule = KNOWN_ITEM_FACE_VALUES.find((r) => r.match.test(name));
  return rule ? Math.round(rule.faceValueUsd * 100) : null;
}

// "$10", "$ 10", "10$" and "10 $" all mean the same thing: one amount. A
// description with two different amounts is ambiguous and returns null.
function singleAmountCents(text: string | null | undefined): number | null {
  const found = new Set<string>();
  const raw = text ?? "";
  for (const match of raw.matchAll(/\$\s*(\d{1,5}(?:\.\d{1,2})?)/g)) found.add(match[1]);
  for (const match of raw.matchAll(/(\d{1,5}(?:\.\d{1,2})?)\s*\$/g)) found.add(match[1]);
  if (found.size !== 1) return null;
  return usdToCents([...found][0]);
}

// The per-unit face value. A known catalog item wins; otherwise exactly one
// distinct dollar amount must appear in the description, then in the item name
// (some legacy items are named "10$ printing grant"). Anything ambiguous
// returns null and the caller keeps the pixel budget.
export function grantFaceValueCents(
  description: string | null | undefined,
  itemName?: string | null,
): number | null {
  const known = itemFaceValueCents(itemName);
  if (known !== null) return known;
  const fromDescription = singleAmountCents(description);
  if (fromDescription !== null) return fromDescription;
  return singleAmountCents(itemName);
}

export interface GrantOrderShape {
  quantity?: number;
  item_name?: string | null;
  item_category?: string | null;
  item_description?: string | null;
}

// Total face value for an order in the grants category, or null when it is
// not a catalog grant (project funding grants are matched separately) or its
// amount cannot be read. Callers fall back to the pixel budget on null.
export function grantOrderFaceCents(order: GrantOrderShape): number | null {
  if (order.item_category !== "grants") return null;
  const unit = grantFaceValueCents(order.item_description, order.item_name);
  if (unit === null) return null;
  const quantity = Math.max(1, Math.floor(Number(order.quantity) || 1));
  return unit * quantity;
}
