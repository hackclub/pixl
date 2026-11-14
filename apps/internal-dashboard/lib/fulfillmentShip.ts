import { sql } from "./pgCompat";

// This transaction owns the status transition, Pixel credit, transaction and
// payout stamp. Retries must not credit twice, even across dashboard replicas.
export interface ShipmentResult {
  userId: string;
  itemName: string;
}

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
      !fulfillerSlackId || !tracking) throw new Error("Invalid fulfillment settlement");

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
          fulfillment_pixels_paid = ${pixels}
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
          fulfillment_pixels_paid = ${pixels}
      from users as buyer
      where o.id = ${orderId}
        and o.status = 'claimed'
        and o.claimed_by_slack = ${fulfillerSlackId}
        and buyer.id = o.user_id
        and (${allowOwnOrder} or buyer.slack_id is distinct from ${fulfillerSlackId})
        and (o.is_grant or exists (
          select 1 from shop_items i where i.id = o.item_id and i.category = 'grants'))
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
