// Beacon unlocks: one per Beacon project a player owns, spent on
// beacon_locked shop items. Shared by the shop routes and the wallet endpoint
// so the dashboard's "how many do I have left" number can never drift from
// what checkout actually enforces.
import { db } from "./db/client.js";

export interface BeaconUnlocks {
  /** Live Beacon projects this player owns (projects.is_peak). */
  projects: number;
  /** Unspent unlocks: projects minus distinct beacon-locked items already owned. */
  available: number;
  /** Ids of beacon-locked items this player already owns (non-cancelled orders). */
  owned: Set<number>;
}

// One unlock per Beacon project (projects.is_peak, live/not banned/rejected/
// archived), minus however many distinct beacon_locked items they already own
// (a non-cancelled order). Shared pool across every beacon_locked item, not
// one-per-item - see toggleProjectPeak in the internal dashboard for how a
// project becomes a Beacon. An owned item stays unlocked for good: buying it
// again never spends another unlock.
export async function beaconUnlocks(userId: string): Promise<BeaconUnlocks> {
  const [{ count: beaconCount }, { data: beaconItemIds }] = await Promise.all([
    db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_peak", true)
      .is("archived_at", null)
      .is("rejected_at", null)
      .is("banned_at", null),
    db.from("shop_items").select("id").eq("beacon_locked", true),
  ]);
  const projects = beaconCount ?? 0;
  const ids = ((beaconItemIds ?? []) as { id: number }[]).map((i) => i.id);
  if (ids.length === 0) return { projects, available: projects, owned: new Set() };
  const { data: orders } = await db
    .from("shop_orders")
    .select("item_id")
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .in("item_id", ids);
  const owned = new Set(((orders ?? []) as { item_id: number }[]).map((o) => Number(o.item_id)));
  return { projects, available: Math.max(projects - owned.size, 0), owned };
}
