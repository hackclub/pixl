import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { orValue } from "../db/pgCompat.js";
import { activeEvents } from "../events.js";
import { levelFor } from "../xp.js";
import { addNotification } from "./notifications.js";
import { decryptPII, encryptPII } from "../crypto.js";

const router = Router();

const SHOP_REGIONS = ["US", "ASIA", "NORTH_AMERICA", "SOUTH_AMERICA", "EUROPE", "INDIA", "AFRICA", "BANGLADESH"];

// ISO 3166-1 alpha-2 -> shop region, from Hack Club Auth's address.country
// (confirmed live: it sends 2-letter codes, not full names). Only a first
// guess for a player who's never picked a region themselves (see
// /api/shop/region below) - anything unmapped falls back to US, same as
// before this existed.
const COUNTRY_REGION: Record<string, string> = {
  IN: "INDIA",
  US: "US",
  // North America (non-US) + Central America/Caribbean
  CA: "NORTH_AMERICA", MX: "NORTH_AMERICA", GT: "NORTH_AMERICA", HN: "NORTH_AMERICA",
  SV: "NORTH_AMERICA", NI: "NORTH_AMERICA", CR: "NORTH_AMERICA", PA: "NORTH_AMERICA",
  DO: "NORTH_AMERICA", JM: "NORTH_AMERICA", TT: "NORTH_AMERICA", BS: "NORTH_AMERICA",
  BZ: "NORTH_AMERICA", CU: "NORTH_AMERICA",
  // South America
  BR: "SOUTH_AMERICA", CO: "SOUTH_AMERICA", CL: "SOUTH_AMERICA", PE: "SOUTH_AMERICA",
  AR: "SOUTH_AMERICA", VE: "SOUTH_AMERICA", EC: "SOUTH_AMERICA", BO: "SOUTH_AMERICA",
  PY: "SOUTH_AMERICA", UY: "SOUTH_AMERICA", GY: "SOUTH_AMERICA", SR: "SOUTH_AMERICA",
  // Europe (incl. UK, and Turkey by shipping convention)
  GB: "EUROPE", DE: "EUROPE", PL: "EUROPE", BE: "EUROPE", NL: "EUROPE", IT: "EUROPE",
  SK: "EUROPE", HU: "EUROPE", RO: "EUROPE", CZ: "EUROPE", ES: "EUROPE", SE: "EUROPE",
  MK: "EUROPE", BG: "EUROPE", FI: "EUROPE", NO: "EUROPE", GR: "EUROPE", PT: "EUROPE",
  LV: "EUROPE", RS: "EUROPE", HR: "EUROPE", AT: "EUROPE", DK: "EUROPE", FR: "EUROPE",
  IE: "EUROPE", CH: "EUROPE", LT: "EUROPE", EE: "EUROPE", SI: "EUROPE", LU: "EUROPE",
  MT: "EUROPE", CY: "EUROPE", IS: "EUROPE", UA: "EUROPE", TR: "EUROPE",
  // Africa
  EG: "AFRICA", NG: "AFRICA", MA: "AFRICA", TN: "AFRICA", GH: "AFRICA", DZ: "AFRICA",
  ZA: "AFRICA", MU: "AFRICA", RE: "AFRICA", KE: "AFRICA", ET: "AFRICA", TZ: "AFRICA",
  UG: "AFRICA", ZM: "AFRICA", ZW: "AFRICA", SN: "AFRICA", CI: "AFRICA", CM: "AFRICA",
  // Asia + Middle East + Oceania (no dedicated bucket for the latter two)
  PK: "ASIA", PH: "ASIA", SG: "ASIA", BD: "BANGLADESH", ID: "ASIA", IL: "ASIA", AE: "ASIA",
  QA: "ASIA", MY: "ASIA", HK: "ASIA", VN: "ASIA", TW: "ASIA", NP: "ASIA", JP: "ASIA",
  KR: "ASIA", CN: "ASIA", TH: "ASIA", SA: "ASIA", KW: "ASIA", BH: "ASIA", OM: "ASIA",
  JO: "ASIA", LB: "ASIA", AU: "ASIA", NZ: "ASIA",
};

export function regionMismatch(itemRegion: string, buyerRegion: string): boolean {
  return itemRegion !== buyerRegion;
}

export function regionForCountry(country: string): string {
  return COUNTRY_REGION[country.trim().toUpperCase()] ?? "US";
}

async function regionFor(userId: string): Promise<string> {
  const { data } = await supabase
    .from("users")
    .select("region, region_auto, address_country")
    .eq("id", userId)
    .maybeSingle();
  const row = data as
    | { region?: string; region_auto?: boolean; address_country?: string }
    | null;
  // region defaults to 'US' NOT NULL, so a stored 'US' alone can't tell a
  // real pick apart from nobody ever touching it - region_auto is what
  // actually says whether it's safe to recompute from the address.
  if (row?.region_auto === false && row.region && SHOP_REGIONS.includes(row.region)) {
    return row.region;
  }
  return regionForCountry(decryptPII(row?.address_country));
}

// Base columns plus unlock_xp (trophies), region and category. unlock_xp/
// config_options arrived with migration 0032/0058, region with 0063, category
// with 0106 , fall back gracefully before each is applied so the catalog
// keeps loading.
const ITEM_COLUMNS =
  "id, name, description, price, image_url, options, unlock_xp, config_options, region, category, unlock_trial_ids, manual_locked, lock_note, beacon_locked, discount_percent, created_at, reserved_user_id";
const ITEM_COLUMNS_FALLBACK = "id, name, description, price, image_url, options";

// How recently an item has to have been added to still be worth flagging as
// new in the catalog. The shop is 539 active items deep and most of it landed
// in bulk drops, so tagging every item with its add date would just be noise ,
// only recent arrivals get a NEW tag and an "Added ..." line.
//
// 14 days puts the tag on ~100 items. 30 would reach ~149 (28% of the shop),
// which stops meaning anything; re-check against the real spread before
// widening this again.
export const NEW_ITEM_DAYS = 14;

// Below this, "Bought by N people" stops being social proof and starts
// reading as "nobody wants this", which is worse for the item than showing
// nothing at all. Sold-once items simply don't get the line.
export const BUYERS_VISIBLE_MIN = 3;

// created_at arrives as a Date, not a string: pgCompat talks to Postgres
// through postgres.js, which parses timestamptz into a JS Date with its
// default type handlers (there's no `types` override on the client). It only
// looks like an ISO string from outside, because res.json() serialises it on
// the way out. Both shapes are accepted so this can't silently go false again
// if the driver or the column type ever changes underneath it.
export function isNewItem(createdAt: unknown, now: Date = new Date()): boolean {
  const added =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string" && createdAt
        ? new Date(createdAt)
        : null;
  if (!added || Number.isNaN(added.getTime())) return false;
  const ageMs = now.getTime() - added.getTime();
  // A clock-skewed future timestamp is still "new", it just isn't old yet.
  return ageMs < NEW_ITEM_DAYS * 86_400_000;
}

export function shouldShowBuyerCount(buyers: unknown): boolean {
  return Number(buyers) >= BUYERS_VISIBLE_MIN;
}

// Personal items (created by an admin for one specific player, see
// drizzle/0212) are only ever shown to that player, in whatever region they
// are in. Everyone else, including signed-out visitors, never sees them. The
// owner's id is replaced by a plain `personal` flag so it doesn't go out in
// the response.
export function scopePersonalItems<T extends Record<string, unknown>>(
  items: T[],
  viewerId: string | null,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const owner = item.reserved_user_id;
    if (owner == null) {
      out.push(item);
      continue;
    }
    if (viewerId && owner === viewerId) {
      const { reserved_user_id: _owner, ...rest } = item;
      out.push({ ...rest, personal: true } as unknown as T);
    }
  }
  return out;
}

// Items are scoped to the player's own region (fulfillment/shipping differ a
// lot by where they live) , pass `region` to filter, or omit it to get every
// region (not currently used, but keeps this function generally useful).
// Restoration reward trophies (unlock_xp > 0) are the exception: they're
// earned, not shipped, so every player sees the same trophies at the same
// XP requirement regardless of region , never scope them to a region.
async function fetchItems(filterIds?: number[], region?: string) {
  const build = (cols: string, withRegion: boolean) => {
    let q = supabase.from("shop_items").select(cols);
    if (filterIds) q = q.in("id", filterIds);
    else q = q.eq("active", true);
    // A personal item (reserved_user_id) is not tied to a region, it is
    // scoped to its player by scopePersonalItems below instead.
    if (withRegion && region)
      q = q.or(`region.eq.${orValue(region)},unlock_xp.gt.0,reserved_user_id.is.not.null`);
    return q.order("position", { ascending: true }).order("id", { ascending: true });
  };
  const first = await build(ITEM_COLUMNS, true);
  if (first.error) {
    const second = await build(ITEM_COLUMNS_FALLBACK, false);
    return {
      error: second.error,
      data: ((second.data ?? []) as unknown as Record<string, unknown>[]).map((i) => ({
        ...i,
        unlock_xp: 0,
        config_options: null,
        region: "US",
        category: "other",
        unlock_trial_ids: [],
        discount_percent: 0,
        created_at: null,
      })),
    };
  }
  return { error: null, data: (first.data ?? []) as unknown as Record<string, unknown>[] };
}

// Per-choice stock pools (e.g. 15 "Ridit" Signed Org Photos) for whichever of
// the given item ids have any , attached to the item as `stock: [{choice,
// remaining, total}]` so the client can show live counts and grey out
// sold-out choices. Items with no pool just don't get a `stock` key.
async function attachStock(items: Record<string, unknown>[]): Promise<void> {
  const ids = items.map((i) => Number(i.id)).filter((id) => Number.isFinite(id));
  if (!ids.length) return;
  const { data } = await supabase
    .from("shop_option_stock")
    .select("item_id, choice, total, remaining")
    .in("item_id", ids);
  if (!data?.length) return;
  const byItem = new Map<number, { choice: string; total: number; remaining: number }[]>();
  for (const row of data as { item_id: number; choice: string; total: number; remaining: number }[]) {
    const list = byItem.get(row.item_id) ?? [];
    list.push({ choice: row.choice, total: row.total, remaining: row.remaining });
    byItem.set(row.item_id, list);
  }
  for (const item of items) {
    const stock = byItem.get(Number(item.id));
    if (stock) item.stock = stock;
  }
}

// "Bought by N people" plus the NEW / "Added ..." flags, attached to every item
// the catalog is about to return. Both rules live here rather than in the page
// so the client only renders what it's told , see NEW_ITEM_DAYS and
// BUYERS_VISIBLE_MIN above for why each threshold exists.
//
// Fail-soft on purpose: before migration 0182 is applied the RPC doesn't
// exist, and a shop that won't load is a far worse outcome than a shop with no
// buyer counts. Same spirit as ITEM_COLUMNS_FALLBACK above.
async function attachBuyerCounts(items: Record<string, unknown>[]): Promise<void> {
  const { data, error } = await supabase.rpc("shop_item_buyer_counts");
  const byItem = new Map<number, number>();
  if (error) {
    console.error("[shop] buyer counts failed", error);
  } else {
    for (const row of (data ?? []) as { item_id: number; buyers: number }[]) {
      byItem.set(Number(row.item_id), Number(row.buyers));
    }
  }
  for (const item of items) {
    const buyers = byItem.get(Number(item.id)) ?? 0;
    item.buyers = buyers;
    item.show_buyers = shouldShowBuyerCount(buyers);
    item.is_new = isNewItem(item.created_at);
  }
}

// Applies each item's discount_percent to every price component it displays
// (base price, and for a configurator item its base_price + each choice's
// price), rounding each one exactly the way buy_shop_item does - so whatever
// combination of add-ons a player picks, the running total the client shows
// always matches what they're actually charged. original_price is kept
// alongside for a "was X" strikethrough; undiscounted items are untouched.
function applyDiscount(items: Record<string, unknown>[]): void {
  const scale = (n: unknown, pct: number): number => Math.round((Number(n) || 0) * (100 - pct) / 100);
  for (const item of items) {
    const pct = Math.max(0, Math.min(100, Number(item.discount_percent) || 0));
    if (pct <= 0) continue;
    item.original_price = item.price;
    item.price = scale(item.price, pct);
    const co = item.config_options as
      | { base_price?: number; reference_url?: string; groups?: { name: string; type: string; choices: { label: string; price: number }[] }[] }
      | null;
    if (co && typeof co === "object") {
      item.config_options = {
        ...co,
        base_price: scale(co.base_price, pct),
        original_base_price: co.base_price,
        groups: Array.isArray(co.groups)
          ? co.groups.map((g) => ({
              ...g,
              choices: Array.isArray(g.choices)
                ? g.choices.map((c) => ({ ...c, price: scale(c.price, pct) }))
                : g.choices,
            }))
          : co.groups,
      };
    }
  }
}

// How many Beacon-locked items this player can still buy: one unlock per
// Beacon project they have (projects.is_peak, live/not banned/rejected/
// archived), minus however many they've already spent on a non-cancelled
// order for a beacon_locked item. Shared pool across every beacon_locked
// item, not one-per-item - see toggleProjectPeak in
// apps/dashboard/app/actions.ts for how a project becomes a Beacon.
async function availableBeaconUnlocks(userId: string): Promise<number> {
  const [{ count: beaconCount }, { data: beaconItemIds }] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_peak", true)
      .is("archived_at", null)
      .is("rejected_at", null)
      .is("banned_at", null),
    supabase.from("shop_items").select("id").eq("beacon_locked", true),
  ]);
  const ids = ((beaconItemIds ?? []) as { id: number }[]).map((i) => i.id);
  if (ids.length === 0) return beaconCount ?? 0;
  const { count: spent } = await supabase
    .from("shop_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "cancelled")
    .in("item_id", ids);
  return Math.max((beaconCount ?? 0) - (spent ?? 0), 0);
}

// Active catalog, plus mystery-merchant items while their event runs , those
// stay inactive in the dashboard so they vanish the moment the event ends.
// Trophy items (unlock_xp > 0) come back flagged with the player's own progress.
// Signed out visitors get the same catalog (browsable, so the shop can be
// shared/linked to anyone) with every personal field defaulted , no saves, no
// trophy progress, gated items locked , since there's no session to look any
// of that up against. Buying/saving/claiming still require a session, same
// as before.
router.get("/api/shop/items", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  // invalid token != guest
  const sessionExpired = !!token && !session;

  const region = session ? await regionFor(session.userId) : "US";
  const { data, error } = await fetchItems(undefined, region);
  if (error) {
    console.error("[shop] items failed", error);
    return res.status(500).json({ ok: false });
  }
  const items: Record<string, unknown>[] = scopePersonalItems(
    data.map((i) => ({ ...i, limited: false })),
    session?.userId ?? null,
  );

  const merchants = await activeEvents(["mystery_merchant"]);
  const limitedIds = [
    ...new Set(
      merchants.flatMap((ev) =>
        Array.isArray(ev.config.itemIds) ? ev.config.itemIds.map(Number) : [],
      ),
    ),
  ].filter((id) => Number.isFinite(id) && !items.some((i) => i.id === id));
  if (limitedIds.length > 0) {
    const { data: limited } = await fetchItems(limitedIds, region);
    const endsAt = merchants.map((m) => m.ends_at).sort()[0];
    for (const i of scopePersonalItems(limited ?? [], session?.userId ?? null))
      items.unshift({ ...i, limited: true, limited_until: endsAt });
  }

  await attachStock(items);
  await attachBuyerCounts(items);

  // Saved (pinned) items, and for a config_options item the last spec the
  // player put together , restored on the detail page instead of resetting
  // to the first choice of every group on each visit. Nothing to look up for
  // a signed-out visitor, so every item defaults to unsaved.
  const savesById = session
    ? new Map(
        (
          (
            await supabase
              .from("shop_saves")
              .select("item_id, option, config")
              .eq("user_id", session.userId)
          ).data ?? []
        ).map((r: { item_id: number; option: string; config: unknown }) => [Number(r.item_id), r]),
      )
    : new Map<number, { item_id: number; option: string; config: unknown }>();
  for (const item of items) {
    const save = savesById.get(Number(item.id));
    item.saved = !!save;
    item.saved_option = save?.option || "";
    item.saved_config = save?.config || null;
  }

  // The player's own trophy progress. Trophies gate on the player's level
  // (1-100, derived from lifetime RE), not raw hours - `unlock_xp` holds the
  // level required. The field name predates levels and isn't worth a migration.
  // A signed-out visitor has no level/claims to report, so trophies just show
  // as locked at 0 XP rather than erroring the whole catalog out.
  const hasTrophies = items.some((i) => Number(i.unlock_xp) > 0);
  let xp = 0;
  let claimed: number[] = [];
  if (hasTrophies && session) {
    const [level, { data: claims }] = await Promise.all([
      levelFor(session.userId),
      supabase.from("shop_claims").select("item_id").eq("user_id", session.userId),
    ]);
    xp = level;
    claimed = ((claims ?? []) as { item_id: number }[]).map((c) => c.item_id);
  }

  // Trial-gated items: an item with unlock_trial_ids is locked until the player
  // has shipped (reached review on) a project linked to at least one of those
  // Trials. We attach `locked` and the Trial names so the client can show what
  // to build to unlock it.
  const gatedIds = [
    ...new Set(
      items.flatMap((i) =>
        Array.isArray(i.unlock_trial_ids) ? (i.unlock_trial_ids as unknown[]).map(Number) : [],
      ),
    ),
  ].filter((id) => Number.isFinite(id) && id > 0);
  if (gatedIds.length > 0) {
    // A signed-out visitor hasn't shipped anything, so every gated item is
    // locked for them , skip the shipped-projects lookup entirely rather than
    // querying it against no user.
    const [{ data: shipped }, { data: trials }] = await Promise.all([
      session
        ? supabase
            .from("projects")
            .select("sidequest_id")
            .eq("user_id", session.userId)
            .not("sidequest_id", "is", null)
            .in("status", ["shipped", "fraud_review", "second_review", "approved"])
        : Promise.resolve({ data: [] as { sidequest_id: number }[] }),
      supabase.from("sidequests").select("id, name, active").in("id", gatedIds),
    ]);
    const done = new Set(((shipped ?? []) as { sidequest_id: number }[]).map((r) => Number(r.sidequest_id)));
    const trialRows = (trials ?? []) as { id: number; name: string; active: boolean }[];
    const nameById = new Map(trialRows.map((t) => [Number(t.id), t.name]));
    const activeById = new Map(trialRows.map((t) => [Number(t.id), !!t.active]));
    for (const i of items) {
      const ids = Array.isArray(i.unlock_trial_ids)
        ? (i.unlock_trial_ids as unknown[]).map(Number)
        : [];
      if (ids.length > 0) {
        i.locked = !ids.some((id) => done.has(id));
        i.unlock_trials = ids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
        // Distinguishes "go ship the trial, it's right there" (Music Grant)
        // from "the trial doesn't exist yet, there's nothing to do" (a
        // placeholder trial seeded for an unlaunched region) , the client
        // shows a plain "coming soon" instead of a lock + call to action
        // when none of the gating trials are active yet.
        i.unlockPending = i.locked && !ids.some((id) => activeById.get(id));
      }
    }
  }

  // A manual lock overrides everything above , always locked regardless of
  // any Trial gate, with its own note instead of "ship this Trial" copy.
  for (const i of items) {
    if (i.manual_locked) {
      i.locked = true;
      i.unlockPending = false;
    }
  }

  // Beacon-locked items: locked unless this player still has an unspent
  // Beacon-project unlock. A manual lock above still wins if both are set.
  let beaconAvailable = 0;
  if (session && items.some((i) => i.beacon_locked)) {
    beaconAvailable = await availableBeaconUnlocks(session.userId);
  }
  for (const i of items) {
    if (i.beacon_locked && !i.manual_locked) {
      i.locked = beaconAvailable < 1;
      i.unlockPending = false;
      i.beaconAvailable = beaconAvailable;
    }
  }

  applyDiscount(items);
  res.json({ ok: true, items, xp, claimed, region, sessionExpired });
});

// Switch which regional catalog the player shops from.
router.post("/api/shop/region", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const region = typeof req.body?.region === "string" ? req.body.region : "";
  if (!SHOP_REGIONS.includes(region))
    return res.status(400).json({ ok: false, error: "invalid_region" });

  const { error } = await supabase
    .from("users")
    .update({ region, region_auto: false })
    .eq("id", session.userId);
  if (error) {
    console.error("[shop] region update failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, region });
});

// Unauthenticated, deliberately minimal: just the fields a link-preview card
// needs (name/description/price/image). Crawlers unfurling a shared /shop/item
// link have no player session to scope a region to, so this ignores region
// entirely and just returns whichever active row has this id.
router.get("/api/shop/item/:id/public", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data, error } = await supabase
    .from("shop_items")
    .select("id, name, description, price, image_url")
    .eq("id", id)
    .eq("active", true)
    .is("reserved_user_id", null)
    .maybeSingle();
  if (error) {
    console.error("[shop] public item lookup failed", error.message);
    return res.status(500).json({ ok: false });
  }
  if (!data) return res.status(404).json({ ok: false });
  res.json({ ok: true, item: data });
});

// Live remaining counts for a stock-limited item's choices (e.g. how many
// "Ridit" Signed Org Photos are left) , polled from the item detail page so
// counts stay current as other players buy without a full page reload.
router.get("/api/shop/stock/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data, error } = await supabase
    .from("shop_option_stock")
    .select("choice, total, remaining")
    .eq("item_id", id);
  if (error) {
    console.error("[shop] stock failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, stock: data ?? [] });
});

// Claim a trophy the player has earned. Server-authoritative: it re-checks the
// XP requirement, so a client can't claim early. Idempotent via the unique
// (user_id, item_id) constraint.
router.post("/api/shop/claim/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: item } = await supabase
    .from("shop_items")
    .select("id, name, unlock_xp, active")
    .eq("id", id)
    .maybeSingle();
  const unlockXp = Number((item as { unlock_xp?: number } | null)?.unlock_xp ?? 0);
  if (!item || !item.active || unlockXp <= 0)
    return res.status(404).json({ ok: false, error: "not_a_trophy" });

  const xp = await levelFor(session.userId);
  if (xp < unlockXp)
    return res.status(400).json({ ok: false, error: "not_eligible", xp, need: unlockXp });

  const { error } = await supabase
    .from("shop_claims")
    .upsert(
      { user_id: session.userId, item_id: id },
      { onConflict: "user_id,item_id", ignoreDuplicates: true },
    );
  if (error) {
    console.error("[shop] claim failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(
    session.userId,
    "Trophy claimed! 🏆",
    `You claimed "${item.name}". The team will reach out about getting it to you.`,
  );
  res.json({ ok: true, claimed: true });
});

// Pin an item (with its current option/config picks, for a configurable
// item) so it's easy to find again and, on the detail page, so an
// in-progress build restores instead of resetting to the first choice of
// every group. Re-posting while already saved overwrites the stored picks ,
// the detail page calls this again on every config change once an item is
// pinned, so a saved build stays in sync as the player keeps deciding.
router.post("/api/shop/save/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  const option = typeof req.body?.option === "string" ? req.body.option.slice(0, 300) : "";
  const config =
    req.body?.config && typeof req.body.config === "object" ? req.body.config : null;

  const { error } = await supabase
    .from("shop_saves")
    .upsert(
      { user_id: session.userId, item_id: id, option, config },
      { onConflict: "user_id,item_id" },
    );
  if (error) {
    console.error("[shop] save failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, saved: true });
});

router.delete("/api/shop/save/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { error } = await supabase
    .from("shop_saves")
    .delete()
    .eq("user_id", session.userId)
    .eq("item_id", id);
  if (error) {
    console.error("[shop] unsave failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, saved: false });
});

// The player's own orders, newest first, for the Orders tab in the dash. Reads
// the fulfillment-pipeline columns (status/tracking/stage stamps) but falls back
// to the base columns so it keeps working before migration 0052 is applied.
const ORDER_COLUMNS =
  "id, item_name, option, price, quantity, status, note, buyer_note, created_at, ordered_at, credited_at, shipped_at, done_at, tracking";
const ORDER_COLUMNS_FALLBACK =
  "id, item_name, option, price, status, note, created_at, fulfilled_at";

router.get("/api/shop/orders", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const build = (cols: string) =>
    supabase
      .from("shop_orders")
      .select(cols)
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(100);

  let { data, error } = await build(ORDER_COLUMNS);
  if (error) ({ data, error } = await build(ORDER_COLUMNS_FALLBACK));
  if (error) {
    console.error("[shop] orders failed", error);
    return res.status(500).json({ ok: false });
  }
  const orders = (data ?? []) as { id: number; status: string }[];

  // Queue position for any still-pending order: FIFO by created_at across
  // EVERY player's pending orders, same "New" queue fulfillers work off in
  // the dashboard - not scoped to this player, the whole point is showing
  // how many orders (anyone's) are ahead of theirs.
  const pendingIds = new Set(orders.filter((o) => o.status === "pending").map((o) => o.id));
  if (pendingIds.size > 0) {
    const { data: queue, error: queueError } = await supabase
      .from("shop_orders")
      .select("id, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (queueError) {
      console.error("[shop] orders queue position failed", queueError);
    } else {
      const positionById = new Map((queue ?? []).map((o, i) => [o.id as number, i + 1]));
      for (const o of orders as (typeof orders[number] & {
        queue_position?: number;
        queue_total?: number;
      })[]) {
        if (pendingIds.has(o.id)) {
          o.queue_position = positionById.get(o.id);
          o.queue_total = queue?.length ?? undefined;
        }
      }
    }
  }

  res.json({ ok: true, orders });
});

// Let a player cancel their own order and get their pixels back, as long as
// fulfillment hasn't shipped it yet. Same cancel_shop_order RPC the dashboard's
// admin cancel button uses (refund + status flip happen together in there, and
// it's idempotent), just reached from the player's own Orders tab instead of
// /fulfillment - p_by is tagged "(self-cancel)" so the fulfillment log can
// tell the two apart.
router.post("/api/shop/orders/:id/cancel", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: order } = await supabase
    .from("shop_orders")
    .select("user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.user_id !== session.userId)
    return res.status(404).json({ ok: false });
  if (["shipped", "done", "cancelled"].includes(order.status as string))
    return res.status(400).json({ ok: false, error: "not_cancellable" });

  const { data: refunded, error } = await supabase.rpc("cancel_shop_order", {
    p_order_id: id,
    p_by: `${session.displayName} (self-cancel)`,
  });
  if (error) {
    console.error("[shop] self-cancel failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, refunded: Number(refunded ?? 0) });
});

// Buy a priced item with pixels. All the real checks (item on sale, affordable,
// pixels deducted) happen inside buy_shop_item under a row lock, so a
// double-click can't overspend. On success we open a pending order the team
// fulfils from the dashboard and tell the player to expect us.
router.post("/api/shop/buy/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  // We physically ship every order, so an address has to be on file before we
  // let the purchase through , see /account in apps/game/web.
  const { data: buyer } = await supabase
    .from("users")
    .select("address_line1, address_city, address_country, address_postal, phone")
    .eq("id", session.userId)
    .maybeSingle();
  const addressOnFile =
    !!buyer &&
    String(buyer.address_line1 ?? "").trim() !== "" &&
    String(buyer.address_city ?? "").trim() !== "" &&
    String(buyer.address_country ?? "").trim() !== "" &&
    String(buyer.address_postal ?? "").trim() !== "";
  const buyerCountry = decryptPII(buyer?.address_country).trim();
  if (!addressOnFile || !buyerCountry)
    return res.status(400).json({ ok: false, error: "address_required" });
  const buyerRegion = regionForCountry(buyerCountry);

  // A phone number is required on the FIRST order only - once one's on file
  // it's reused silently on every order after, same "ask once, reuse
  // forever" shape as the address check above. Fulfillers need it to
  // actually get a physical prize delivered (see the Shipping info
  // disclosure on /fulfillment).
  const phoneOnFile = decryptPII(buyer?.phone).trim();
  if (!phoneOnFile) {
    const rawPhone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    if (rawPhone.length < 7 || rawPhone.length > 20)
      return res.status(400).json({ ok: false, error: "phone_required" });
    const { error: phoneErr } = await supabase
      .from("users")
      .update({ phone: encryptPII(rawPhone) })
      .eq("id", session.userId);
    if (phoneErr) console.error("[shop] failed to save phone", phoneErr.message);
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  const option = typeof req.body?.option === "string" ? req.body.option.slice(0, 80) : "";
  // Structured picks for items with a real price-varying configurator
  // (config_options). Ignored by buy_shop_item for every other item.
  const config =
    req.body?.config && typeof req.body.config === "object" ? req.body.config : null;
  // How many of this item to buy in one order. Clamped again server-side
  // inside buy_shop_item , this is just so a garbage value doesn't even reach it.
  const rawQty = Number(req.body?.quantity);
  const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.min(999, Math.round(rawQty))) : 1;
  // Free-text note to whoever fulfils the order, and (for items with a
  // per-choice stock pool, e.g. Signed Org Photo) the raw picked choice.
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : "";
  const stockChoice =
    typeof req.body?.stockChoice === "string" ? req.body.stockChoice.slice(0, 80) : "";

  // Trial-gated items can't be bought until the player has shipped one of the
  // unlocking Trials (mirrors the `locked` flag computed for the catalog).
  // A manual lock (see updateShopItem in the dashboard) blocks purchase
  // outright, independent of any Trial.
  const { data: gateRow } = await supabase
    .from("shop_items")
    .select("unlock_trial_ids, manual_locked, region, unlock_xp, beacon_locked, reserved_user_id")
    .eq("id", id)
    .maybeSingle();
  if ((gateRow as { manual_locked?: boolean } | null)?.manual_locked)
    return res.status(403).json({ ok: false, error: "locked" });
  if ((gateRow as { beacon_locked?: boolean } | null)?.beacon_locked) {
    const available = await availableBeaconUnlocks(session.userId);
    if (available < 1) return res.status(403).json({ ok: false, error: "locked" });
  }
  // Personal item: only its player can buy it, from any region.
  const reservedFor = (gateRow as { reserved_user_id?: string | null } | null)?.reserved_user_id ?? null;
  if (reservedFor && reservedFor !== session.userId)
    return res.status(404).json({ ok: false, error: "unavailable" });
  const itemRegion = reservedFor ? undefined : (gateRow as { region?: string } | null)?.region;
  const itemUnlockXp = Number((gateRow as { unlock_xp?: number } | null)?.unlock_xp ?? 0);
  if (itemRegion && itemUnlockXp <= 0 && regionMismatch(itemRegion, buyerRegion))
    return res.status(403).json({ ok: false, error: "wrong_region", region: buyerRegion });
  const gateIds = Array.isArray((gateRow as { unlock_trial_ids?: unknown[] } | null)?.unlock_trial_ids)
    ? ((gateRow as { unlock_trial_ids: unknown[] }).unlock_trial_ids).map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (gateIds.length > 0) {
    const { data: shipped } = await supabase
      .from("projects")
      .select("sidequest_id")
      .eq("user_id", session.userId)
      .not("sidequest_id", "is", null)
      .in("status", ["shipped", "fraud_review", "second_review", "approved"]);
    const done = new Set(((shipped ?? []) as { sidequest_id: number }[]).map((r) => Number(r.sidequest_id)));
    if (!gateIds.some((tid) => done.has(tid)))
      return res.status(403).json({ ok: false, error: "locked" });
  }

  const { data, error } = await supabase.rpc("buy_shop_item", {
    p_user_id: session.userId,
    p_item_id: id,
    p_option: option,
    p_config: config,
    p_quantity: quantity,
    p_note: note,
    p_stock_choice: stockChoice,
    p_buyer_region: buyerRegion,
  });
  if (error) {
    console.error("[shop] buy failed", error);
    return res.status(500).json({ ok: false });
  }
  const result = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    balance?: number;
    price?: number;
    item_name?: string;
    quantity?: number;
  };
  if (!result.ok) {
    return res.status(result.error === "insufficient" ? 400 : 409).json(result);
  }

  const qtyPrefix = (result.quantity ?? 1) > 1 ? `${result.quantity}x ` : "";
  void addNotification(
    session.userId,
    "Order placed! 🛍️",
    `You bought ${qtyPrefix}"${result.item_name}"${option ? ` (${option})` : ""}. The team will reach out about getting it to you.`,
  );
  res.json({ ok: true, balance: result.balance });
});

export default router;
