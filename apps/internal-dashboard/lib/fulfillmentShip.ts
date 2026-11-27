import { sql } from "./pgCompat";

// This transaction owns the status transition, Pixel credit, transaction and
// payout stamp. Retries must not credit twice, even across dashboard replicas.
export interface ShipmentResult {
  userId: string;
  itemName: string;
}

// The tracking number is optional: an envelope, software key or hand-delivered
// item has none, and the order still counts as shipped and gets paid.
export async function settleShipment(
  orderId: number,
  tracking: string,
  fulfillerSlackId: string,
  fulfillerName: string,
  pixels: number,
  client: typeof sql = sql,
  // Owners may ship their own order; everyone else is refused below.
  allowOwnOrder = false,
): Promise<ShipmentResult | null> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 ||
      !Number.isSafeInteger(pixels) || pixels <= 0 ||
      !fulfillerSlackId) throw new Error("Invalid fulfillment settlement");

  return client.begin(async (tx) => {
    const fulfillers = await tx`select id from users where slack_id = ${fulfillerSlackId} for update`;
    if (fulfillers.length !== 1) throw new Error("Fulfiller must have a Pixl player account before shipping");

    const shipped = await tx`
      update shop_orders as o
      set status = 'shipped',
          shipped_at = now(),
          fulfilled_at = now(),
          fulfilled_by = ${fulfillerName},
          tracking = ${tracking},
          fulfillment_pixels_paid = o.fulfillment_pixels_paid + ${pixels}
      from users as buyer
      where o.id = ${orderId}
        and o.status = 'credited'
        and o.claimed_by_slack = ${fulfillerSlackId}
        and buyer.id = o.user_id
        and (${allowOwnOrder} or buyer.slack_id is distinct from ${fulfillerSlackId})
      returning o.user_id, o.item_name`;
    if (!shipped.length) return null;

    const credited = await tx`
      update users set pixels = pixels + ${pixels}
      where id = ${fulfillers[0]!.id}
      returning id`;
    if (credited.length !== 1) throw new Error("Fulfiller wallet unavailable");

    await tx`insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (${fulfillers[0]!.id}, null, ${pixels}, 0, 'fulfillment_payout', 'payout system')`;

    return { userId: String(shipped[0]!.user_id), itemName: String(shipped[0]!.item_name) };
  }) as Promise<ShipmentResult | null>;
}

// The single item fulfillment step: claimed/ordered/credited -> done, with the
// HCB transaction, real cost and (optional) tracking recorded. Tracking is not
// a separate stage: grants, software and hand-delivered items simply have none.
// Same atomic guarantees as settleShipment: the status transition, wallet
// credit, ledger row and payout stamp commit together or not at all.
export async function settleItemFulfillment(
  orderId: number,
  fields: { tracking: string; hcbLink: string; actualCostUsd: number },
  fulfillerSlackId: string,
  fulfillerName: string,
  pixels: number,
  client: typeof sql = sql,
  // Owners may fulfil their own order; everyone else is refused below.
  allowOwnOrder = false,
): Promise<ShipmentResult | null> {
  const { tracking, hcbLink, actualCostUsd } = fields;
  if (!Number.isSafeInteger(orderId) || orderId <= 0 ||
      !Number.isSafeInteger(pixels) || pixels <= 0 ||
      !Number.isFinite(actualCostUsd) || actualCostUsd < 0 ||
      !fulfillerSlackId || !hcbLink) throw new Error("Invalid item fulfillment");

  return client.begin(async (tx) => {
    const fulfillers = await tx`select id from users where slack_id = ${fulfillerSlackId} for update`;
    if (fulfillers.length !== 1) throw new Error("Fulfiller must have a Pixl player account before fulfilling");

    const fulfilled = await tx`
      update shop_orders as o
      set status = 'done',
          ordered_at = coalesce(o.ordered_at, now()),
          credited_at = coalesce(o.credited_at, now()),
          shipped_at = case when ${tracking} <> '' then now() else o.shipped_at end,
          done_at = now(),
          fulfilled_at = now(),
          fulfilled_by = ${fulfillerName},
          hcb_link = ${hcbLink},
          actual_cost_usd = ${actualCostUsd},
          tracking = ${tracking},
          fulfillment_pixels_paid = o.fulfillment_pixels_paid + ${pixels}
      from users as buyer
      where o.id = ${orderId}
        and o.status in ('claimed', 'ordered', 'credited')
        and o.claimed_by_slack = ${fulfillerSlackId}
        and buyer.id = o.user_id
        and (${allowOwnOrder} or buyer.slack_id is distinct from ${fulfillerSlackId})
      returning o.user_id, o.item_name`;
    if (!fulfilled.length) return null;

    const credited = await tx`
      update users set pixels = pixels + ${pixels}
      where id = ${fulfillers[0]!.id}
      returning id`;
    if (credited.length !== 1) throw new Error("Fulfiller wallet unavailable");

    await tx`insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (${fulfillers[0]!.id}, null, ${pixels}, 0, 'fulfillment_payout', 'payout system')`;

    return { userId: String(fulfilled[0]!.user_id), itemName: String(fulfilled[0]!.item_name) };
  }) as Promise<ShipmentResult | null>;
}

// Grants skip ordered/credited/shipped: one transaction takes a claimed grant
// order straight to done, stamps every stage at the same instant (so the
// timeline and reports that read ordered_at/credited_at/shipped_at stay
// consistent), records the HCB grant link and real cost, and credits the
// fulfiller. Same guarantees as settleShipment: the status transition, the
// wallet credit, the ledger row and the payout stamp all commit together or not
// at all, so a retry across dashboard replicas can never pay twice.
export async function settleGrant(
  orderId: number,
  grantLink: string,
  actualCostUsd: number,
  fulfillerSlackId: string,
  fulfillerName: string,
  pixels: number,
  client: typeof sql = sql,
  // Owners may fulfil their own order; everyone else is refused below.
  allowOwnOrder = false,
): Promise<ShipmentResult | null> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 ||
      !Number.isSafeInteger(pixels) || pixels <= 0 ||
      !Number.isFinite(actualCostUsd) || actualCostUsd < 0 ||
      !fulfillerSlackId || !grantLink) throw new Error("Invalid grant settlement");

  return client.begin(async (tx) => {
    const fulfillers = await tx`select id from users where slack_id = ${fulfillerSlackId} for update`;
    if (fulfillers.length !== 1) throw new Error("Fulfiller must have a Pixl player account before sending a grant");

    const sent = await tx`
      update shop_orders as o
      set status = 'done',
          ordered_at = now(),
          credited_at = now(),
          shipped_at = now(),
          done_at = now(),
          fulfilled_at = now(),
          fulfilled_by = ${fulfillerName},
          tracking = ${grantLink},
          hcb_link = ${grantLink},
          actual_cost_usd = ${actualCostUsd},
          fulfillment_pixels_paid = o.fulfillment_pixels_paid + ${pixels}
      from users as buyer
      where o.id = ${orderId}
        and o.status = 'claimed'
        and o.claimed_by_slack = ${fulfillerSlackId}
        and buyer.id = o.user_id
        and (${allowOwnOrder} or buyer.slack_id is distinct from ${fulfillerSlackId})
        and (o.is_grant or (not o.item_flow and exists (
          select 1 from shop_items i where i.id = o.item_id and i.category = 'grants')))
      returning o.user_id, o.item_name`;
    if (!sent.length) return null;

    const credited = await tx`
      update users set pixels = pixels + ${pixels}
      where id = ${fulfillers[0]!.id}
      returning id`;
    if (credited.length !== 1) throw new Error("Fulfiller wallet unavailable");

    await tx`insert into pixel_transactions (user_id, project_id, amount, hours, reason, created_by)
      values (${fulfillers[0]!.id}, null, ${pixels}, 0, 'fulfillment_payout', 'payout system')`;

    return { userId: String(sent[0]!.user_id), itemName: String(sent[0]!.item_name) };
  }) as Promise<ShipmentResult | null>;
}

// Releases a claimed order that has not been purchased or fulfilled yet.
// The claimer or an owner can release it; the order goes back to `pending` and
// its funding commitment is deleted in the same transaction, so the reservation
// stops counting against the player's next order. A second click (or a release
// after the order moved on) is a no-op.
export async function releaseOrderClaim(
  orderId: number,
  bySlack: string,
  allowAnyClaim: boolean,
  client: typeof sql = sql,
): Promise<boolean> {
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !bySlack) {
    throw new Error("Invalid claim release");
  }

  return client.begin(async (tx) => {
    const released = await tx`
      update shop_orders
      set status = 'pending',
          claimed_by = '',
          claimed_by_slack = '',
          claimed_at = null,
          ordered_at = null
      where id = ${orderId}
        and status = 'claimed'
        and (${allowAnyClaim} or claimed_by_slack = ${bySlack})
      returning id`;
    if (!released.length) return false;

    await tx`delete from fulfillment_commitments where order_id = ${orderId}`;
    return true;
  }) as Promise<boolean>;
}

export type FulfillmentFlow = "grant" | "item";

export interface UnfulfillResult {
  userId: string;
  itemName: string;
  status: "claimed" | "pending";
  claimerSlack: string;
  pixelsPaid: number;
}

// Reopens a done/shipped order without undoing its payout. The previous
// fulfillment (who, when, HCB link, cost, tracking, payout) is copied to
// shop_order_unfulfillments together with the reason, so the order row can
// start a fresh attempt without losing the record of the first one. The claim
// is kept where there was one; a legacy order with no claimer goes back to the
// New queue. `flow` optionally switches the order between the grant and normal
// item flows for the retry (e.g. a refunded grant that is now bought directly).
//
// The wallet payout and pixel_transactions row are intentionally untouched:
// the fulfiller keeps what they were paid, and the next settlement adds to
// shop_orders.fulfillment_pixels_paid rather than replacing it.
export async function unfulfillOrder(
  orderId: number,
  reason: string,
  by: string,
  bySlack: string,
  opts: { flow?: FulfillmentFlow | null } = {},
  client: typeof sql = sql,
): Promise<UnfulfillResult | null> {
  const why = reason.trim().slice(0, 300);
  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !why || !by || !bySlack) {
    throw new Error("Invalid unfulfillment");
  }
  const flow = opts.flow ?? null;

  return client.begin(async (tx) => {
    const rows = await tx`
      select o.id, o.user_id, o.item_name, o.status, o.claimed_by, o.claimed_by_slack,
             o.fulfilled_at, o.fulfilled_by, o.hcb_link, o.tracking,
             o.actual_cost_usd, o.fulfillment_pixels_paid, o.is_grant, o.item_flow,
             coalesce(i.category, '') as item_category,
             coalesce(o.fulfilled_at, o.done_at, o.shipped_at) as completed_at
        from shop_orders o
        left join shop_items i on i.id = o.item_id
       where o.id = ${orderId}
         and o.status in ('done', 'shipped')
       for update of o`;
    const o = rows[0];
    if (!o) return null;

    // How the attempt being undone was completed. is_grant wins over item_flow,
    // exactly like isGrantOrder in lib/fulfillmentGrant.ts.
    const kind: FulfillmentFlow =
      o.is_grant === true ? "grant" : o.item_flow === true ? "item" : o.item_category === "grants" ? "grant" : "item";
    const prior = await tx`
      select coalesce(sum(pixels_paid), 0)::int as paid
        from shop_order_unfulfillments
       where order_id = ${orderId}`;
    const pixelsPaid = Math.max(0, Number(o.fulfillment_pixels_paid) - Number(prior[0]?.paid ?? 0));

    await tx`
      insert into shop_order_unfulfillments (
        order_id, fulfillment_kind, fulfilled_at, fulfilled_by, fulfilled_by_slack,
        hcb_link, tracking, actual_cost_usd, pixels_paid,
        unfulfilled_by, unfulfilled_by_slack, reason
      ) values (
        ${orderId}, ${kind}, ${o.completed_at ?? null}, ${String(o.fulfilled_by ?? "")},
        ${String(o.claimed_by_slack ?? "")}, ${String(o.hcb_link ?? "")}, ${String(o.tracking ?? "")},
        ${o.actual_cost_usd ?? null}, ${pixelsPaid}, ${by}, ${bySlack}, ${why}
      )`;

    const updated = await tx`
      update shop_orders
      set status = case when coalesce(claimed_by_slack, '') <> '' then 'claimed' else 'pending' end,
          claimed_by = case when coalesce(claimed_by_slack, '') <> '' then claimed_by else '' end,
          claimed_by_slack = case when coalesce(claimed_by_slack, '') <> '' then claimed_by_slack else '' end,
          claimed_at = case when coalesce(claimed_by_slack, '') <> '' then claimed_at else null end,
          ordered_at = null,
          credited_at = null,
          shipped_at = null,
          done_at = null,
          fulfilled_at = null,
          fulfilled_by = '',
          tracking = '',
          hcb_link = '',
          actual_cost_usd = null,
          item_flow = case when ${flow}::text = 'item' then true
                           when ${flow}::text = 'grant' then false
                           else item_flow end,
          is_grant = case when ${flow}::text = 'grant' then true
                          when ${flow}::text = 'item' then false
                          else is_grant end
      where id = ${orderId}
        and status in ('done', 'shipped')
      returning user_id, item_name, status, claimed_by_slack`;
    const row = updated[0];
    if (!row) return null;

    // No claimer means the order is back in the New queue, so its old funding
    // commitment no longer reserves anything.
    if (row.status === "pending") {
      await tx`delete from fulfillment_commitments where order_id = ${orderId}`;
    }

    return {
      userId: String(row.user_id),
      itemName: String(row.item_name),
      status: row.status as "claimed" | "pending",
      claimerSlack: String(row.claimed_by_slack ?? ""),
      pixelsPaid,
    };
  }) as Promise<UnfulfillResult | null>;
}
