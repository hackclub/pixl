// Shop-change notifications for pixorpheus (the Slack bot).
//
// The original design was a Postgres trigger calling pg_net (migration 0103),
// which only works on Supabase, pg_net is a Supabase extension and is not
// available (nor installable) on the CNPG cluster the stack runs on now, so on
// CNPG the trigger silently skips itself. So the POST is made here, from the
// app, right after a successful shop_items write. That works regardless of the
// database behind `db`.
//
// The payload deliberately keeps the exact shape a Supabase Database Webhook
// would send, so pixorpheus' /webhooks/shop handler needs no changes.

const PIXORPHEUS_URL = (process.env.PIXORPHEUS_URL ?? "https://pixo.pixl.rsvp").replace(/\/+$/, "");

// pixorpheus answers 200 and processes asynchronously, so this is quick. It
// must never block or fail a shop mutation, the write already succeeded by the
// time we get here.
const TIMEOUT_MS = 5000;

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
  try {
    const res = await fetch(`${PIXORPHEUS_URL}/webhooks/shop`, {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[shop-notify] pixorpheus returned ${res.status} for ${type}`);
    }
  } catch (e: unknown) {
    console.error("[shop-notify]", e instanceof Error ? e.message : e);
  }
}

export async function notifyShopInsert(row: ShopRowSnapshot): Promise<void> {
  await post("INSERT", row, null);
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
