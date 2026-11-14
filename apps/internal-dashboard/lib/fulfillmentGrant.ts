// Grant orders skip the item pipeline (claim -> ordered -> credited -> shipped)
// and use a short one: claim -> send grant -> done. An order is a grant when its
// shop item is in the "grants" category, or a fulfiller converted that single
// order with "Convert to grant" (shop_orders.is_grant, migration 0240).

// Flat pixel payout to whoever fulfils an order, by kind. Credited by
// settleShipment (items) and settleGrant (grants) in lib/fulfillmentShip.ts.
export const ITEM_FULFILLMENT_PAYOUT_PIXELS = 6;
export const GRANT_FULFILLMENT_PAYOUT_PIXELS = 2;

export interface GrantShaped {
  item_category?: string | null;
  is_grant?: boolean | null;
}

export function isGrantOrder(order: GrantShaped): boolean {
  return order.is_grant === true || order.item_category === "grants";
}

export function fulfillmentPayoutPixels(order: GrantShaped): number {
  return isGrantOrder(order) ? GRANT_FULFILLMENT_PAYOUT_PIXELS : ITEM_FULFILLMENT_PAYOUT_PIXELS;
}

// Grants are claimed and then sent in one step. Orders that were already moved
// past "claimed" by the old item flow (ordered/credited/shipped) keep the
// standard controls so nothing in flight gets stranded.
export function usesGrantFlow(order: GrantShaped & { status: string }): boolean {
  return isGrantOrder(order) && (order.status === "pending" || order.status === "claimed" || order.status === "done");
}

// The grant stepper: New -> Claimed -> Grant sent.
export const GRANT_STAGES = ["pending", "claimed", "done"] as const;
export const GRANT_STAGE_LABEL: Record<(typeof GRANT_STAGES)[number], string> = {
  pending: "New",
  claimed: "Claimed",
  done: "Grant sent",
};
export const GRANT_STAGE_HINT: Record<(typeof GRANT_STAGES)[number], string> = {
  pending: "Request received",
  claimed: "Assigned; grant not sent yet",
  done: "HCB grant sent to the buyer's email",
};
