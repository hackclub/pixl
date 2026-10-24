import { pixorpheusUrl } from "@/lib/pixo";
import { callPixo } from "@/lib/pixoCall";

// Shop-change notifications for pixorpheus (the Slack bot).
//
// The original design was a Postgres trigger calling pg_net (migration 0103),
// which needs the pg_net extension. pg_net is not
// available (nor installable) on the CNPG cluster the stack runs on now, so on
// CNPG the trigger silently skips itself. So the POST is made here, from the
// app, right after a successful shop_items write. That works regardless of the
// database behind `db`.
//
// The payload deliberately keeps the exact shape that trigger would have
// sent, so pixorpheus' /webhooks/shop handler needs no changes.

export interface ShopRowSnapshot {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string;
  options: unknown;
  active: boolean;
  position: number;
  created_by: string;
  region?: string | null;
  unlock_xp?: number | null;
  price_source_url?: string | null;
}

type ChangeType = "INSERT" | "UPDATE" | "DELETE";

let warnedMissingSecret = false;

async function post(
  type: ChangeType,
  record: ShopRowSnapshot | null,
  oldRecord: ShopRowSnapshot | null,
): Promise<void> {
  const secret = process.env.SHOP_WEBHOOK_SECRET;
  if (!secret) {
    // pixorpheus refuses unauthenticated calls with a 503, so without the
    // secret there is nothing useful to send. Warn once, not per mutation.
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error("[shop-notify] SHOP_WEBHOOK_SECRET is not set; shop changes will not be announced");
    }
    return;
  }
  // Never throws and never fails the shop write; a down Pixo is logged and
  // audited by callPixo and the change simply isn't announced.
  await callPixo(`shop-notify ${type}`, `${pixorpheusUrl()}/webhooks/shop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shop-webhook-secret": secret,
    },
    body: JSON.stringify({
      type,
      table: "shop_items",
      schema: "public",
      record,
      old_record: oldRecord,
    }),
  });
}

export async function notifyShopInsert(row: ShopRowSnapshot): Promise<void> {
  await post("INSERT", row, null);
}

// A funding grant approved with a project ships directly into shop_orders,
// outside the player's /api/shop/buy route. Notify opted-in fulfillers from
// that insertion too, using the same authenticated Pixo endpoint as the game
// server. Callers should fire-and-forget this so the approval never waits on
// Slack.
export async function notifyNewShopOrder(orderId: number): Promise<void> {
  const secret = process.env.EXTERNAL_API_KEY;
  if (!secret) {
    console.error("[shop-notify] EXTERNAL_API_KEY is not set; order alert was not sent");
    return;
  }
  await callPixo("shop-order-alert", `${pixorpheusUrl()}/api/external/shop-order-alert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": secret,
    },
    body: JSON.stringify({ orderId }),
  });
}

export async function notifyShopDelete(row: ShopRowSnapshot): Promise<void> {
  await post("DELETE", null, row);
}

/** Pairs before/after snapshots by id and fires one UPDATE per changed row.
 *  pixorpheus buffers for 2s and collapses identical edits across regions into
 *  a single message, so sending one call per affected row is intended. */
export async function notifyShopUpdates(
  before: ShopRowSnapshot[],
  after: ShopRowSnapshot[],
): Promise<void> {
  const byId = new Map(before.map((r) => [r.id, r]));
  await Promise.all(
    after.map((newRow) => {
      const oldRow = byId.get(newRow.id);
      return oldRow ? post("UPDATE", newRow, oldRow) : Promise.resolve();
    }),
  );
}
