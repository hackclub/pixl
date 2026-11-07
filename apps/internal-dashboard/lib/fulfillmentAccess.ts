// Who may see / act on which shop order. Pure (no Next, no DB) so the rules
// are unit-testable; app/fulfillment/* and the order actions in app/actions.ts
// call these.

export interface FulfillmentViewer {
  isOwner: boolean;
  session: { slackId: string };
}

export interface OrderOwnership {
  claimed_by_slack?: string | null;
  player_slack?: string | null;
}

// True when `slackId` is the fulfiller who claimed this order. An empty
// claimed_by_slack (unclaimed) never matches, even for an empty slackId.
export function claimedBy(order: OrderOwnership, slackId: string): boolean {
  const claimer = (order.claimed_by_slack ?? "").trim();
  return claimer !== "" && claimer === slackId.trim();
}

// Buyer PII (legal name, email, phone, mailing address) is only decrypted for
// the fulfiller who has claimed that specific order, or for an owner. Every
// other fulfiller sees the buyer's country only (enough to decide whether to
// claim it), so browsing the queue doesn't hand out hundreds of kids'
// addresses.
export function canSeeBuyerDetails(order: OrderOwnership, viewer: FulfillmentViewer): boolean {
  return viewer.isOwner || claimedBy(order, viewer.session.slackId);
}

// The printable address label: same rule (it's the address in large print).
export const canViewLabel = canSeeBuyerDetails;

// A fulfiller must never claim/ship their own shop order (they'd be sourcing
// and approving their own purchase and earning the fulfillment payout on it).
// Owners are not exempt: an owner's own order goes to someone else too.
export function isOwnOrder(order: OrderOwnership, slackId: string): boolean {
  const buyer = (order.player_slack ?? "").trim();
  return buyer !== "" && buyer === slackId.trim();
}

// Flagging an order over budget is part of working it, so only the fulfiller
// who claimed it (or an owner) may do it.
export function canFlagOrder(order: OrderOwnership, viewer: FulfillmentViewer): boolean {
  return viewer.isOwner || claimedBy(order, viewer.session.slackId);
}

export function canOpenFulfillmentTab(tab: string, viewer: Pick<FulfillmentViewer, "isOwner">): boolean {
  return tab !== "fulfillers" || viewer.isOwner;
}

export interface OrderActionContext {
  status: string;
  flagged: boolean;
  hasBuyerSlack: boolean;
  mine: boolean;
  ownOrder: boolean;
  canManage: boolean;
}

export interface VisibleOrderActions {
  primary: boolean;
  flag: boolean;
  contact: boolean;
  edit: boolean;
  any: boolean;
}

export function visibleOrderActions(c: OrderActionContext): VisibleOrderActions {
  const actionable = c.status !== "done" && c.status !== "cancelled";
  let primary = false;
  if (actionable) {
    if (c.status === "shipped") primary = c.canManage;
    else if (!c.mine && c.status !== "pending") primary = c.canManage;
    else primary = true;
  }
  const flag = actionable && c.status !== "shipped" && (c.mine || c.canManage) && (!c.flagged || c.canManage);
  const contact = actionable && c.hasBuyerSlack;
  const edit = c.canManage && c.status !== "pending" && c.status !== "claimed" && c.status !== "cancelled";
  return { primary, flag, contact, edit, any: primary || flag || contact || edit };
}
