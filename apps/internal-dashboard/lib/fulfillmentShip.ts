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
        and buyer.slack_id is distinct from ${fulfillerSlackId}
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
