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

// The per-unit face value from a description. Exactly one distinct "$N"
// amount must appear: zero means there is nothing to read, and several means
// we cannot tell which one is the grant.
export function grantFaceValueCents(description: string | null | undefined): number | null {
  const found = new Set<string>();
  for (const match of (description ?? "").matchAll(/\$\s*(\d{1,5}(?:\.\d{1,2})?)/g)) found.add(match[1]);
  if (found.size !== 1) return null;
  return usdToCents([...found][0]);
}

export interface GrantOrderShape {
  quantity?: number;
  item_category?: string | null;
  item_description?: string | null;
}

// Total face value for an order in the grants category, or null when it is
// not a catalog grant (project funding grants are matched separately) or its
// description has no single readable amount. Callers fall back to the pixel
// budget on null.
export function grantOrderFaceCents(order: GrantOrderShape): number | null {
  if (order.item_category !== "grants") return null;
  const unit = grantFaceValueCents(order.item_description);
  if (unit === null) return null;
  const quantity = Math.max(1, Math.floor(Number(order.quantity) || 1));
  return unit * quantity;
}
