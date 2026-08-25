import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { activeEvents } from "../events.js";
import { levelFor } from "../xp.js";
import { addNotification } from "./notifications.js";

const router = Router();

const SHOP_REGIONS = ["US", "ASIA", "NORTH_AMERICA", "SOUTH_AMERICA", "EUROPE", "INDIA", "AFRICA"];

async function regionFor(userId: string): Promise<string> {
  const { data } = await supabase.from("users").select("region").eq("id", userId).maybeSingle();
  const region = (data as { region?: string } | null)?.region;
  return region && SHOP_REGIONS.includes(region) ? region : "US";
}

// Base columns plus unlock_xp (trophies), region and category. unlock_xp/
// config_options arrived with migration 0032/0058, region with 0063, category
// with 0106 — fall back gracefully before each is applied so the catalog
// keeps loading.
const ITEM_COLUMNS =
  "id, name, description, price, image_url, options, unlock_xp, config_options, region, category, unlock_trial_ids";
const ITEM_COLUMNS_FALLBACK = "id, name, description, price, image_url, options";

// Items are scoped to the player's own region (fulfillment/shipping differ a
// lot by where they live) — pass `region` to filter, or omit it to get every
// region (not currently used, but keeps this function generally useful).
// Restoration reward trophies (unlock_xp > 0) are the exception: they're
// earned, not shipped, so every player sees the same trophies at the same
// XP requirement regardless of region — never scope them to a region.
async function fetchItems(filterIds?: number[], region?: string) {
  const build = (cols: string, withRegion: boolean) => {
    let q = supabase.from("shop_items").select(cols);
    if (filterIds) q = q.in("id", filterIds);
    else q = q.eq("active", true);
    if (withRegion && region) q = q.or(`region.eq.${region},unlock_xp.gt.0`);
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
      })),
    };
  }
  return { error: null, data: (first.data ?? []) as unknown as Record<string, unknown>[] };
}

// Per-choice stock pools (e.g. 15 "Ridit" Signed Org Photos) for whichever of
// the given item ids have any — attached to the item as `stock: [{choice,
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

// Active catalog, plus mystery-merchant items while their event runs — those
// stay inactive in the dashboard so they vanish the moment the event ends.
// Trophy items (unlock_xp > 0) come back flagged with the player's own progress.
// Signed out visitors get the same catalog (browsable, so the shop can be
// shared/linked to anyone) with every personal field defaulted — no saves, no
// trophy progress, gated items locked — since there's no session to look any
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
  const items: Record<string, unknown>[] = data.map((i) => ({ ...i, limited: false }));

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
    for (const i of limited ?? []) items.unshift({ ...i, limited: true, limited_until: endsAt });
  }

  await attachStock(items);

  // Saved (pinned) items, and for a config_options item the last spec the
  // player put together — restored on the detail page instead of resetting
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
    // locked for them — skip the shipped-projects lookup entirely rather than
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
        // placeholder trial seeded for an unlaunched region) — the client
        // shows a plain "coming soon" instead of a lock + call to action
        // when none of the gating trials are active yet.
        i.unlockPending = i.locked && !ids.some((id) => activeById.get(id));
      }
    }
  }

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

  const { error } = await supabase.from("users").update({ region }).eq("id", session.userId);
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
    .maybeSingle();
  if (error) {
    console.error("[shop] public item lookup failed", error.message);
    return res.status(500).json({ ok: false });
  }
  if (!data) return res.status(404).json({ ok: false });
  res.json({ ok: true, item: data });
});

// Live remaining counts for a stock-limited item's choices (e.g. how many
// "Ridit" Signed Org Photos are left) — polled from the item detail page so
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
// every group. Re-posting while already saved overwrites the stored picks —
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
  res.json({ ok: true, orders: data ?? [] });
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
  // let the purchase through — see /account in apps/game/web.
  const { data: buyer } = await supabase
    .from("users")
    .select("address_line1, address_city, address_country, address_postal")
    .eq("id", session.userId)
    .maybeSingle();
  const addressOnFile =
    !!buyer &&
    String(buyer.address_line1 ?? "").trim() !== "" &&
    String(buyer.address_city ?? "").trim() !== "" &&
    String(buyer.address_country ?? "").trim() !== "" &&
    String(buyer.address_postal ?? "").trim() !== "";
  if (!addressOnFile)
    return res.status(400).json({ ok: false, error: "address_required" });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  const option = typeof req.body?.option === "string" ? req.body.option.slice(0, 80) : "";
  // Structured picks for items with a real price-varying configurator
  // (config_options). Ignored by buy_shop_item for every other item.
  const config =
    req.body?.config && typeof req.body.config === "object" ? req.body.config : null;
  // How many of this item to buy in one order. Clamped again server-side
  // inside buy_shop_item — this is just so a garbage value doesn't even reach it.
  const rawQty = Number(req.body?.quantity);
  const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.min(999, Math.round(rawQty))) : 1;
  // Free-text note to whoever fulfils the order, and (for items with a
  // per-choice stock pool, e.g. Signed Org Photo) the raw picked choice.
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : "";
  const stockChoice =
    typeof req.body?.stockChoice === "string" ? req.body.stockChoice.slice(0, 80) : "";

  // Trial-gated items can't be bought until the player has shipped one of the
  // unlocking Trials (mirrors the `locked` flag computed for the catalog).
  const { data: gateRow } = await supabase
    .from("shop_items")
    .select("unlock_trial_ids")
    .eq("id", id)
    .maybeSingle();
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

  let { data, error } = await supabase.rpc("buy_shop_item", {
    p_user_id: session.userId,
    p_item_id: id,
    p_option: option,
    p_config: config,
    p_quantity: quantity,
    p_note: note,
    p_stock_choice: stockChoice,
  });
  // Only when migration 0093 (note + stock choice) genuinely isn't applied and
  // the 7-arg signature is missing, 42883. Retrying on any error instead would
  // swallow real failures: every overload here has defaults, so a 5-arg call
  // matches both the 5- and 7-arg ones and dies with "is not unique" (42725),
  // reporting that instead of whatever actually went wrong.
  if (error?.code === "42883") {
    ({ data, error } = await supabase.rpc("buy_shop_item", {
      p_user_id: session.userId,
      p_item_id: id,
      p_option: option,
      p_config: config,
      p_quantity: quantity,
    }));
  }
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
