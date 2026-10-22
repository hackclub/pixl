// Shop item shape (GET /api/shop/items) and pure display helpers shared by
// the catalog grid and the item detail page. Display only: every price here
// is a server value; the server re-checks price, stock and locks on buy.

export interface StockEntry {
  choice: string;
  remaining: number;
  total: number;
}

export interface ConfigChoice {
  label: string;
  price?: number;
  image?: string;
}

export interface ConfigGroup {
  name: string;
  type?: "multi" | "single";
  choices: ConfigChoice[];
}

export interface ConfigOptions {
  base_price: number;
  original_base_price?: number;
  reference_url?: string;
  groups: ConfigGroup[];
}

export type ConfigPicks = Record<string, string | string[]>;

export interface ShopItem {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  original_price?: number | null;
  discount_percent?: number | null;
  category?: string | null;
  unlock_xp: number;
  options?: string[] | null;
  config_options?: ConfigOptions | null;
  stock?: StockEntry[] | null;
  saved?: boolean;
  saved_option?: string | null;
  saved_config?: ConfigPicks | null;
  limited?: boolean;
  limited_until?: string | null;
  locked?: boolean;
  unlockPending?: boolean;
  lock_note?: string | null;
  beacon_locked?: boolean;
  manual_locked?: boolean;
  beaconAvailable?: number;
  unlock_trials?: string[] | null;
  is_new?: boolean;
  show_buyers?: boolean;
  buyers?: number;
  created_at?: string | null;
}

export interface ShopItemsResponse {
  ok: boolean;
  items?: ShopItem[];
  xp?: number;
  claimed?: (number | string)[];
  region?: string;
  sessionExpired?: boolean;
}

export const REGIONS: [string, string][] = [
  ["US", "US"],
  ["NORTH_AMERICA", "North America"],
  ["SOUTH_AMERICA", "South America"],
  ["EUROPE", "Europe"],
  ["ASIA", "Asia"],
  ["INDIA", "India"],
  ["AFRICA", "Africa"],
  ["BANGLADESH", "Bangladesh"],
];
export const REGION_IDS = REGIONS.map(([v]) => v) as [string, ...string[]];

export const CATEGORIES: [string, string][] = [
  ["all", "ALL"],
  ["grants", "GRANTS"],
  ["merch", "MERCH"],
  ["tech", "TECH"],
  ["printers", "3D PRINTERS"],
  ["software", "SOFTWARE & LICENSES"],
  ["kits", "DIY KITS"],
  ["other", "OTHER"],
];

export function normalizeItems(raw: ShopItem[] | undefined): ShopItem[] {
  return (raw ?? []).map((i) => ({
    ...i,
    id: Number(i.id),
    price: Number(i.price),
    unlock_xp: Number(i.unlock_xp || 0),
  }));
}

export function basePrice(item: ShopItem): number {
  return item.config_options ? Number(item.config_options.base_price) : Number(item.price);
}

/** The server only sends original_price when a discount is active. */
export function isDiscounted(item: ShopItem): boolean {
  return item.original_price !== undefined && item.original_price !== null;
}

export function originalBasePrice(item: ShopItem): number {
  return item.config_options
    ? Number(item.config_options.original_base_price ?? item.original_price ?? 0)
    : Number(item.original_price ?? 0);
}

export function isTrophy(item: ShopItem): boolean {
  return Number(item.unlock_xp) > 0;
}

export type TrophyState = "claimed" | "claimable" | "locked";

export function trophyState(item: ShopItem, xp: number, claimed: Set<number>): TrophyState {
  if (claimed.has(item.id)) return "claimed";
  return xp >= Number(item.unlock_xp) ? "claimable" : "locked";
}

/** Price <= 0 means not sold in this region (yet). */
export function isPending(item: ShopItem): boolean {
  return Number(item.price) <= 0;
}

export function lockReason(item: ShopItem): string {
  if (item.lock_note) return item.lock_note;
  if (item.beacon_locked) return "Beacon reward: no unlocks left. A nominated Beacon project earns one.";
  const trials = (item.unlock_trials ?? []).map((t) => `"${t}"`).join(" or ");
  // Trial-gated items unlock once the Trial project is APPROVED in review,
  // not merely shipped (apps/server's shop gate).
  return `Get ${trials || "the required Trial"} approved to unlock this.`;
}

/** "Added Sep 19", formatted in UTC so it's the same day everywhere. */
export function addedLabel(item: ShopItem): string {
  const d = new Date(String(item.created_at || ""));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** Buyer count / "added" line; both switches are the server's call. */
export function metaBits(item: ShopItem): string[] {
  const bits: string[] = [];
  const buyers = Number(item.buyers) || 0;
  if (item.show_buyers) bits.push(`Bought by ${buyers.toLocaleString()} ${buyers === 1 ? "person" : "people"}`);
  if (item.is_new) {
    const added = addedLabel(item);
    if (added) bits.push(`Added ${added}`);
  }
  return bits;
}

export function countdown(iso: string | null | undefined): string {
  const ms = new Date(String(iso)).getTime() - Date.now();
  if (!isFinite(ms) || ms <= 0) return "gone!";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${s}s left`;
}
