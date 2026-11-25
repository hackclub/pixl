import { escapeMrkdwn } from "../slack/escape.js";

// Pure formatting for shop-change notifications (no Slack app import, so it
// is testable). Every admin-authored string (names, descriptions, lock
// notes, region codes) goes through esc() before it reaches mrkdwn.

// Database-webhook-style payload for a table change (sent by the internal
// dashboard after each shop_items write).
export type ShopRow = {
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
  unlock_trial_ids?: unknown[] | null;
  manual_locked?: boolean | null;
  lock_note?: string | null;
  beacon_locked?: boolean | null;
  discount_percent?: number | null;
  discount_ends_at?: string | Date | null;
};

export type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: ShopRow | null;
  old_record: ShopRow | null;
};

// Stable display order for regions in a grouped message.
const REGION_ORDER = [
  "US",
  "NORTH_AMERICA",
  "SOUTH_AMERICA",
  "EUROPE",
  "ASIA",
  "INDIA",
  "AFRICA",
  "BANGLADESH",
];

/** Numbers only: a non-numeric "price" from the payload never reaches mrkdwn. */
const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const px = (n: number | null | undefined) => `${num(n)}px`;
/** Admin-authored text: &, <, > escaped so it can't mention, ping or link. */
const esc = (s: unknown): string => escapeMrkdwn(typeof s === "string" ? s : String(s ?? ""));
/** Region codes render inside backticks, so backticks are stripped too. */
const escRegion = (r: string): string => esc(r).replace(/`/g, "");
export const region = (r: ShopRow): string => (typeof r.region === "string" && r.region ? r.region : "US");

/** Sale end timestamps compare by instant, not by string shape. */
const saleEnd = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
};
const utcLabel = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;

function sortRegions(regions: Iterable<string>): string[] {
  return [...new Set(regions)].sort((a, b) => {
    const ia = REGION_ORDER.indexOf(a);
    const ib = REGION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

/** `US`, `EUROPE`, `ASIA` → "`US` `EUROPE` `ASIA`" */
function regionTags(regions: Iterable<string>): string {
  return sortRegions(regions)
    .map((r) => `\`${escRegion(r)}\``)
    .join(" ");
}

/** Truncate long text (descriptions) so a message stays readable. */
function short(s: string, max = 140): string {
  const t = (typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Human-readable list of what changed between two rows on an UPDATE.
 *  Shared fields and the region-scoped sale go here; the same edit across
 *  regions produces identical lines (and therefore groups into one message). */
export function diffLines(oldRow: ShopRow, newRow: ShopRow): string[] {
  const lines: string[] = [];

  if (oldRow.name !== newRow.name) {
    lines.push(`• name: *${esc(oldRow.name)}* → *${esc(newRow.name)}*`);
  }
  if (oldRow.price !== newRow.price) {
    lines.push(`• price: ${px(oldRow.price)} → ${px(newRow.price)}`);
  }
  if ((oldRow.description ?? "") !== (newRow.description ?? "")) {
    lines.push(`• description:\n> _${esc(short(oldRow.description))}_\n> ↳ ${esc(short(newRow.description))}`);
  }
  if (!!oldRow.active !== !!newRow.active) {
    lines.push(`• ${newRow.active ? "activated ✅ (now visible in shop)" : "deactivated 🚫 (hidden from shop)"}`);
  }
  if ((oldRow.image_url ?? "") !== (newRow.image_url ?? "")) {
    lines.push(`• image updated`);
  }
  if (JSON.stringify(oldRow.options) !== JSON.stringify(newRow.options)) {
    lines.push(`• options changed`);
  }
  if ((oldRow.position ?? 0) !== (newRow.position ?? 0)) {
    lines.push(`• position: ${num(oldRow.position)} → ${num(newRow.position)}`);
  }
  if (!!oldRow.manual_locked !== !!newRow.manual_locked) {
    lines.push(
      newRow.manual_locked
        ? `• 🔒 manually locked${newRow.lock_note ? ` - _${esc(short(newRow.lock_note, 100))}_` : ""}`
        : "• 🔓 manual lock removed",
    );
  }
  if (!!oldRow.beacon_locked !== !!newRow.beacon_locked) {
    lines.push(
      newRow.beacon_locked
        ? "• 🔒 Beacon-locked (needs an unspent Beacon-project unlock)"
        : "• 🔓 Beacon lock removed",
    );
  }
  if (JSON.stringify(oldRow.unlock_trial_ids ?? []) !== JSON.stringify(newRow.unlock_trial_ids ?? [])) {
    lines.push("• Trial gate changed");
  }
  if ((oldRow.discount_percent ?? 0) !== (newRow.discount_percent ?? 0)) {
    const pct = num(newRow.discount_percent);
    lines.push(pct > 0 ? `• 🏷️ discount: ${pct}% off` : "• discount removed");
  }
  const oldSaleEnd = saleEnd(oldRow.discount_ends_at);
  const newSaleEnd = saleEnd(newRow.discount_ends_at);
  if (oldSaleEnd !== newSaleEnd) {
    lines.push(newSaleEnd ? `• 🏷️ sale ends: ${utcLabel(newSaleEnd)}` : "• sale end removed");
  }

  return lines;
}

// ── Aggregation buffer ──────────────────────────────────────────────────────
// One bucket per distinct change, keyed so identical edits across regions merge.
export type Bucket = {
  kind: WebhookPayload["type"];
  name: string;
  regions: Set<string>;
  lines: string[]; // UPDATE: the shared diff
  prices: Map<string, number>; // INSERT: region → price (prices differ per region)
};

export function render(b: Bucket): string {
  const tags = regionTags(b.regions);
  const n = b.regions.size;
  const regionWord = n === 1 ? "region" : "regions";

  if (b.kind === "INSERT") {
    // Prices differ per region, so list each one; collapse if they're all equal.
    const uniquePrices = new Set(b.prices.values());
    if (uniquePrices.size <= 1) {
      const p = [...uniquePrices][0];
      return `🆕 *New shop item* - *${esc(b.name)}* · ${px(p)} · ${n} ${regionWord}: ${tags}`;
    }
    const list = sortRegions(b.regions)
      .map((r) => `• \`${escRegion(r)}\` - ${px(b.prices.get(r))}`)
      .join("\n");
    return `🆕 *New shop item* - *${esc(b.name)}* · added to ${n} ${regionWord}:\n${list}`;
  }

  if (b.kind === "DELETE") {
    return `🗑️ *Shop item removed* - *${esc(b.name)}* · ${n} ${regionWord}: ${tags}`;
  }

  // UPDATE
  return `✏️ *Shop item updated* - *${esc(b.name)}* · ${n} ${regionWord}: ${tags}\n${b.lines.join("\n")}`;
}


// ── Replay / duplicate protection ───────────────────────────────────────────
// The sender may retry, and a captured request could be replayed while the
// shared secret is valid. When the request carries an id, each id is only
// processed once within the TTL. (No id -> no dedup, same as before.)
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdFrom(headers: Record<string, unknown>, body: unknown): string | null {
  const candidates: unknown[] = [
    headers["x-pixl-request-id"],
    headers["x-request-id"],
    headers["idempotency-key"],
  ];
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    candidates.push((body as Record<string, unknown>).request_id);
  }
  for (const c of candidates) {
    if (typeof c === "string" && REQUEST_ID_RE.test(c)) return c;
  }
  return null;
}

export class RecentIds {
  private readonly seenAt = new Map<string, number>();
  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly max = 5000,
  ) {}

  /** True if `id` was already seen within the TTL; records it otherwise. */
  checkAndRecord(id: string, now = Date.now()): boolean {
    for (const [k, at] of this.seenAt) {
      if (now - at < this.ttlMs && this.seenAt.size <= this.max) break;
      this.seenAt.delete(k);
    }
    const at = this.seenAt.get(id);
    if (at !== undefined && now - at < this.ttlMs) return true;
    this.seenAt.delete(id);
    this.seenAt.set(id, now);
    return false;
  }
}
