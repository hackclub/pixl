import crypto from "crypto";
import express from "express";
import { app, receiver } from "../slack/app.js";

// Where shop-change notifications go. Defaults to the #shop-changes channel
// the team asked for; override with SHOP_NOTIFY_CHANNEL if it ever moves.
const SHOP_CHANNEL = process.env.SHOP_NOTIFY_CHANNEL || "C0BA5SAEZQS";

// When the same edit is applied to several regions (e.g. the dashboard's
// "apply name & description to every region" box), the DB trigger fires one
// webhook per region, all within a few ms. Buffer briefly and collapse
// identical changes into a single message that lists the regions.
const AGGREGATION_WINDOW_MS = 2000;

// Supabase Database Webhook payload for a table change.
type ShopRow = {
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
};

type WebhookPayload = {
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
];

const px = (n: number | null | undefined) => `${n ?? 0}px`;
const region = (r: ShopRow) => r.region || "US";

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
    .map((r) => `\`${r}\``)
    .join(" ");
}

/** Truncate long text (descriptions) so a message stays readable. */
function short(s: string, max = 140): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Human-readable list of what changed between two rows on an UPDATE.
 *  Only region-independent fields go here, so the same edit across regions
 *  produces identical lines (and therefore groups into one message). */
function diffLines(oldRow: ShopRow, newRow: ShopRow): string[] {
  const lines: string[] = [];

  if (oldRow.name !== newRow.name) {
    lines.push(`• name: *${oldRow.name}* → *${newRow.name}*`);
  }
  if (oldRow.price !== newRow.price) {
    lines.push(`• price: ${px(oldRow.price)} → ${px(newRow.price)}`);
  }
  if ((oldRow.description ?? "") !== (newRow.description ?? "")) {
    lines.push(`• description:\n> _${short(oldRow.description)}_\n> ↳ ${short(newRow.description)}`);
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
    lines.push(`• position: ${oldRow.position ?? 0} → ${newRow.position ?? 0}`);
  }

  return lines;
}

// ── Aggregation buffer ──────────────────────────────────────────────────────
// One bucket per distinct change, keyed so identical edits across regions merge.
type Bucket = {
  kind: WebhookPayload["type"];
  name: string;
  regions: Set<string>;
  lines: string[]; // UPDATE: the shared diff
  prices: Map<string, number>; // INSERT: region → price (prices differ per region)
};

const buckets = new Map<string, Bucket>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, AGGREGATION_WINDOW_MS);
}

function enqueue(key: string, seed: () => Bucket, reg: string, price?: number): void {
  let b = buckets.get(key);
  if (!b) {
    b = seed();
    buckets.set(key, b);
  }
  b.regions.add(reg);
  if (price != null) b.prices.set(reg, price);
  scheduleFlush();
}

async function flush(): Promise<void> {
  const pending = [...buckets.values()];
  buckets.clear();

  for (const b of pending) {
    try {
      await app.client.chat.postMessage({ channel: SHOP_CHANNEL, text: render(b) });
    } catch (e: any) {
      console.error("[shop-webhook] post failed:", e?.message ?? e);
    }
  }
}

function render(b: Bucket): string {
  const tags = regionTags(b.regions);
  const n = b.regions.size;
  const regionWord = n === 1 ? "region" : "regions";

  if (b.kind === "INSERT") {
    // Prices differ per region, so list each one; collapse if they're all equal.
    const uniquePrices = new Set(b.prices.values());
    if (uniquePrices.size <= 1) {
      const p = [...uniquePrices][0];
      return `🆕 *New shop item* - *${b.name}* · ${px(p)} · ${n} ${regionWord}: ${tags}`;
    }
    const list = sortRegions(b.regions)
      .map((r) => `• \`${r}\` - ${px(b.prices.get(r))}`)
      .join("\n");
    return `🆕 *New shop item* - *${b.name}* · added to ${n} ${regionWord}:\n${list}`;
  }

  if (b.kind === "DELETE") {
    return `🗑️ *Shop item removed* - *${b.name}* · ${n} ${regionWord}: ${tags}`;
  }

  // UPDATE
  return `✏️ *Shop item updated* - *${b.name}* · ${n} ${regionWord}: ${tags}\n${b.lines.join("\n")}`;
}

function handleShopChange(payload: WebhookPayload): void {
  if (payload.table !== "shop_items") return;

  if (payload.type === "INSERT" && payload.record) {
    const r = payload.record;
    enqueue(
      `INSERT::${r.name}`,
      () => ({ kind: "INSERT", name: r.name, regions: new Set(), lines: [], prices: new Map() }),
      region(r),
      r.price,
    );
    return;
  }

  if (payload.type === "DELETE" && payload.old_record) {
    const r = payload.old_record;
    enqueue(
      `DELETE::${r.name}`,
      () => ({ kind: "DELETE", name: r.name, regions: new Set(), lines: [], prices: new Map() }),
      region(r),
    );
    return;
  }

  if (payload.type === "UPDATE" && payload.record && payload.old_record) {
    const lines = diffLines(payload.old_record, payload.record);
    if (lines.length === 0) return; // no meaningful field changed
    const r = payload.record;
    // Key by the new name + the exact diff, so the SAME edit across regions
    // merges, while a region-specific price change stays its own message.
    const key = `UPDATE::${r.name}::${lines.join("|")}`;
    enqueue(
      key,
      () => ({ kind: "UPDATE", name: r.name, regions: new Set(), lines, prices: new Map() }),
      region(r),
    );
    return;
  }
}

// Supabase Database Webhooks POST JSON here, protected by a shared secret
// sent as a custom header (set SHOP_WEBHOOK_SECRET and add the matching
// header in the Supabase webhook config / trigger). The secret is required —
// without it configured, the endpoint refuses all requests rather than
// accepting unverified ones.
receiver.app.post("/webhooks/shop", express.json({ limit: "1mb" }), (req, res) => {
  const secret = process.env.SHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[shop-webhook] SHOP_WEBHOOK_SECRET is not set; refusing request");
    return res.status(503).send("Service misconfigured");
  }
  const provided = req.headers["x-shop-webhook-secret"];
  const providedBuf = Buffer.from(typeof provided === "string" ? provided : "");
  const secretBuf = Buffer.from(secret);
  if (providedBuf.length !== secretBuf.length || !crypto.timingSafeEqual(providedBuf, secretBuf)) {
    return res.status(401).send("Invalid secret");
  }
  res.status(200).send("ok");
  try {
    handleShopChange(req.body as WebhookPayload);
  } catch (e: any) {
    console.error("[shop-webhook]", e?.message ?? e);
  }
});
