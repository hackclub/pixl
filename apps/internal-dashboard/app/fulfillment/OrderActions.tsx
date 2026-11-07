import { cancelOrder, clearOrderFlag, claimOrder, markOrderPlaced, flagOrderOverBudget, markOrderCredited, markOrderDone, reassignOrder, shipOrder, updateOrderFulfillmentInfo } from "@/app/actions";
import type { ShopOrderRow } from "@/lib/db";
import { ActionButton, Details, Field, Input, Muted } from "@/app/_ui/ui";
import { usdBudget } from "./shared";

// Corrects the HCB link / actual cost / tracking after the fact. Deliberately
// not gated by `actionable`: a typo'd link or a wrong cost still needs fixing
// once an order is done. Owner-only, same as updateOrderFulfillmentInfo.
export function EditFulfillmentInfo({ order: o }: { order: ShopOrderRow }) {
  return (
    <Details summary="Edit HCB link, cost, tracking or source URL">
      <form action={updateOrderFulfillmentInfo} className="fw-order-action-form">
        <input type="hidden" name="id" value={o.id} />
        <div className="fw-order-action-fields">
          <Field label="HCB link">
            <Input name="hcbLink" type="url" maxLength={300} required defaultValue={o.hcb_link} />
          </Field>
          <Field label="Actual cost ($)">
            <Input
              name="actualCostUsd"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={o.actual_cost_usd !== null ? Number(o.actual_cost_usd) : undefined}
            />
          </Field>
          <Field label="Tracking">
            <Input name="tracking" maxLength={120} defaultValue={o.tracking} />
          </Field>
          <Field label="Bought from" hint="Saved onto the item for the next fulfiller">
            <Input
              name="sourceUrl"
              type="url"
              maxLength={500}
              defaultValue={o.item_source_url ?? ""}
              placeholder="https://..."
            />
          </Field>
        </div>
        <div className="fw-order-action-buttons">
          <ActionButton variant="outline" pendingLabel="Saving...">
            Save changes
          </ActionButton>
        </div>
      </form>
    </Details>
  );
}

// Sourcing escalation. A fulfiller who can't buy the item for what the player's
// pixels are worth flags it here instead of ordering it over budget; an owner
// clears the flag once they've decided what to do about it.
export function FlagControls({ order: o, canManage, budget }: { order: ShopOrderRow; canManage: boolean; budget: string }) {
  if (o.flagged_at) {
    if (!canManage) return null;
    return (
      <form action={clearOrderFlag}>
        <input type="hidden" name="id" value={o.id} />
        <ActionButton variant="outline" size="sm" pendingLabel="Clearing..." icon="checkmark">
          Clear flag
        </ActionButton>
      </form>
    );
  }
  return (
    <Details summary={`Can't source it for $${budget}?`}>
      <form action={flagOrderOverBudget} className="fw-order-flag-form">
        <input type="hidden" name="id" value={o.id} />
        <Field label="What's the cheapest you found, and where?">
          <Input name="flagNote" maxLength={300} required placeholder="Cheapest is $95 on Amazon, $88 refurb on eBay" />
        </Field>
        <ActionButton variant="danger" pendingLabel="Flagging..." icon="flag">
          Flag over budget
        </ActionButton>
      </form>
    </Details>
  );
}

export function OrderActions({
  order: o,
  mine,
  ownOrder,
  canManage,
}: {
  order: ShopOrderRow;
  mine: boolean;
  ownOrder: boolean;
  canManage: boolean;
}) {
  // Reassign, cancel/refund and the final "mark done" stay owner-only:
  // fulfillers can work a claimed order but not override or refund one. Cancel
  // is offered until the order ships, claimed or not (cancelOrder in
  // app/actions.ts enforces the same rule server-side).
  const claimed = o.status === "claimed" || o.status === "ordered" || o.status === "credited";
  const cancelForm =
    canManage && (o.status === "pending" || claimed) ? (
      <form action={cancelOrder}>
        <input type="hidden" name="id" value={o.id} />
        <ActionButton
          variant="danger"
          pendingLabel="Refunding..."
          confirm={
            claimed
              ? `${o.claimed_by || "A fulfiller"} already claimed this order${o.status === "credited" ? " and it is already paid" : ""}. Cancel it anyway and refund ${o.price} pixels to ${o.player_name}?`
              : `Cancel this order and refund ${o.price} pixels to ${o.player_name}?`
          }
        >
          Cancel &amp; refund
        </ActionButton>
      </form>
    ) : null;

  // Shipped: the only thing left is the final close.
  if (o.status === "shipped") {
    if (!canManage) return null;
    return (
      <form action={markOrderDone}>
        <input type="hidden" name="id" value={o.id} />
        <ActionButton variant="success" pendingLabel="Closing..." icon="checkmark">
          Mark done
        </ActionButton>
      </form>
    );
  }

  // Claimed by someone else: offer to take it over rather than acting on their queue.
  if (!mine && o.status !== "pending") {
    if (!canManage) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Muted className="w-full text-sm">
          Claimed by <b>{o.claimed_by || "another fulfiller"}</b>
          {o.status === "credited" ? ", already paid" : ""}.
        </Muted>
        <form action={reassignOrder}>
          <input type="hidden" name="id" value={o.id} />
          <ActionButton variant="outline" pendingLabel="Taking over..." icon="member-add">
            Reassign to me
          </ActionButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  if (o.status === "pending") {
    // claimOrder refuses a fulfiller's own order server-side too.
    if (ownOrder) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Muted className="text-sm">This is your own order, so someone else has to fulfill it.</Muted>
          {cancelForm}
        </div>
      );
    }
    return (
      <div className="flex flex-wrap items-end gap-2">
        <form action={claimOrder}>
          <input type="hidden" name="id" value={o.id} />
          <ActionButton pendingLabel="Claiming..." icon="member-add">
            Claim order
          </ActionButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  if (o.status === "claimed") {
    return (
      <div className="fw-order-action-stack">
        <Muted className="text-sm">Assigned to you. Nothing has been purchased yet.</Muted>
        <form action={markOrderPlaced}>
          <input type="hidden" name="id" value={o.id} />
          <ActionButton pendingLabel="Marking placed..." icon="bag">
            Mark order placed
          </ActionButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  // Ordered -> credited needs the HCB link and actual cost: the transaction
  // only exists once HCB has actually charged the card.
  if (o.status === "ordered") {
    return (
      <div className="fw-order-action-stack">
        <form action={markOrderCredited} className="fw-order-action-form">
          <input type="hidden" name="id" value={o.id} />
          <div className="fw-order-action-fields">
            <Field label="HCB link" hint="The transaction or grant this was paid from">
              <Input name="hcbLink" type="url" maxLength={300} required placeholder="https://hcb.hackclub.com/..." />
            </Field>
            <Field label="Actual cost ($)">
              <Input name="actualCostUsd" type="number" min="0" step="0.01" required placeholder={usdBudget(o.price)} />
            </Field>
            <Field label="Bought from" hint="Optional, saved onto the item" className="fw-order-action-field-wide">
              <Input
                name="sourceUrl"
                type="url"
                maxLength={500}
                defaultValue={o.item_source_url ?? ""}
                placeholder="https://..."
              />
            </Field>
          </div>
          <div className="fw-order-action-buttons">
            <ActionButton pendingLabel="Saving..." icon="checkmark">
              Mark credited (receipt uploaded)
            </ActionButton>
          </div>
        </form>
        {cancelForm}
      </div>
    );
  }

  // Credited -> shipped: keep tracking and confirmation controls separate.
  return (
    <div className="fw-order-action-stack">
      <form action={shipOrder} className="fw-order-action-form">
        <input type="hidden" name="id" value={o.id} />
        <div className="fw-order-action-fields">
          <Field label="Tracking number" hint="DM'd to the buyer" className="fw-order-action-field-wide">
            <Input name="tracking" maxLength={120} required placeholder="1Z..." />
          </Field>
        </div>
        <div className="fw-order-action-buttons">
          <ActionButton pendingLabel="Shipping..." icon="send">
            Mark shipped
          </ActionButton>
        </div>
      </form>
      {cancelForm}
    </div>
  );
}
