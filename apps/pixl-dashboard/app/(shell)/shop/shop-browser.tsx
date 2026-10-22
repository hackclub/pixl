"use client";

// Catalog grid: search, sort, price tiers, categories, saved/unlocked
// toggles, region switch. All filtering is over the server's item list.
import Image from "next/image";
import { useMemo, useState } from "react";
import { autoGrid, divider, emptyNote, field, Notice, selectField } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useAction } from "@/components/use-action";
import { saveItem, unsaveItem } from "./actions";
import type { EarnRates } from "../calc/estimates";
import { ItemCard } from "./item-card";
import { RegionSelect } from "./region-select";
import { CATEGORIES, basePrice, isTrophy, trophyState, type ShopItem } from "./shop-lib";
import { TrophyCard } from "./trophy-card";

type Tier = "all" | "afford" | "under" | "over";
type Sort = "featured" | "cheap" | "pricey" | "name";

const tierBtn = (on: boolean) =>
  cn(
    "border-2 border-stroke bg-panel px-[12px] py-[6px] font-sans text-[12.5px] font-bold tracking-[.2px] text-faint",
    "hover:border-faint hover:text-ink",
    on && "border-transparent bg-gold text-btn-ink hover:border-transparent hover:text-btn-ink",
  );
const tiersRow = "mb-[16px] flex flex-wrap gap-[7px]";

const TIERS: [Tier, string][] = [
  ["all", "ALL"],
  ["afford", "AFFORDABLE NOW"],
  ["under", "UNDER 500"],
  ["over", "500+"],
];

export function ShopBrowser({
  items: initialItems,
  xp,
  claimed,
  region,
  pixels,
  beaconUnlocks,
  beaconProjects,
  initialBeaconOnly,
  rates,
}: {
  items: ShopItem[];
  xp: number;
  claimed: number[];
  region: string;
  pixels: number | null;
  /** Unspent Beacon-locked shop unlocks, or null if the wallet failed. */
  beaconUnlocks: number | null;
  /** Beacon projects the player owns (earned, not necessarily unspent). */
  beaconProjects: number | null;
  initialBeaconOnly: boolean;
  rates: EarnRates | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("featured");
  const [tier, setTier] = useState<Tier>("all");
  const [category, setCategory] = useState("all");
  const [unlockedOnly, setUnlockedOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [beaconOnly, setBeaconOnly] = useState(initialBeaconOnly);
  const claimedSet = useMemo(() => new Set(claimed), [claimed]);
  const save = useAction(saveItem);
  const unsave = useAction(unsaveItem);

  // Server props win after a revalidation (region switch, claim).
  const [seen, setSeen] = useState(initialItems);
  if (seen !== initialItems) {
    setSeen(initialItems);
    setItems(initialItems);
  }

  const canAfford = (i: ShopItem) => pixels !== null && pixels >= basePrice(i);
  const hasBeaconItems = items.some((i) => i.beacon_locked);
  const needle = q.trim().toLowerCase();
  const match = (i: ShopItem) =>
    !needle || i.name.toLowerCase().includes(needle) || String(i.description || "").toLowerCase().includes(needle);
  const tierMatch = (i: ShopItem) =>
    tier === "afford" ? canAfford(i) : tier === "under" ? basePrice(i) < 500 : tier === "over" ? basePrice(i) >= 500 : true;

  const trophies = items
    .filter((i) => isTrophy(i) && match(i))
    .filter((i) => !unlockedOnly || trophyState(i, xp, claimedSet) !== "locked");

  let list = items.filter(
    (i) =>
      !isTrophy(i) &&
      match(i) &&
      tierMatch(i) &&
      (category === "all" || (i.category || "other") === category) &&
      (!savedOnly || i.saved) &&
      (!beaconOnly || i.beacon_locked),
  );
  if (sort === "cheap") list = [...list].sort((a, b) => basePrice(a) - basePrice(b));
  else if (sort === "pricey") list = [...list].sort((a, b) => basePrice(b) - basePrice(a));
  else if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  else list = [...list].sort((a, b) => (a.category === "grants" ? 1 : 0) - (b.category === "grants" ? 1 : 0));
  list = [...list].sort((a, b) => (b.saved ? 1 : 0) - (a.saved ? 1 : 0));

  async function toggleSave(item: ShopItem) {
    const nowSaved = !item.saved;
    const flip = (v: boolean) => setItems((all) => all.map((i) => (i.id === item.id ? { ...i, saved: v } : i)));
    flip(nowSaved);
    const r = nowSaved
      ? await save.run({ id: item.id, option: item.saved_option || "", config: item.saved_config ?? null })
      : await unsave.run({ id: item.id });
    if (!r.ok) flip(!nowSaved);
  }

  const err = save.error || unsave.error;

  return (
    <div>
      <Notice className="mb-[14px]">
        Heads up: the photo is a representative example, not a guarantee. For hardware items especially, the exact brand
        or model you receive may differ based on what&apos;s actually available in your region.
      </Notice>

      {beaconUnlocks !== null ? (
        <div className="mb-[14px] flex flex-wrap items-center gap-[12px] border-2 border-stroke bg-[color-mix(in_srgb,var(--gold)_16%,var(--panel))] px-[14px] py-[12px] shadow-drop">
          <Image
            src="/img/pixl-ui/icon_beacon.png"
            alt=""
            aria-hidden
            width={34}
            height={34}
            className="size-[34px] shrink-0 [image-rendering:pixelated]"
          />
          <div className="min-w-0 flex-1">
            <div className="font-pixel text-[12px] tracking-[.8px] text-ink">BEACON UNLOCKS</div>
            <p className="mt-[3px] text-[13px] leading-[1.45] text-dim">
              {beaconUnlocks > 0
                ? `${beaconUnlocks} unspent · One unlock claims one Beacon-locked reward. An item you already own stays unlocked.`
                : beaconProjects
                  ? "All unlocks spent · Another Beacon project earns another Beacon-locked reward."
                  : "No unlocks yet · A reviewer-nominated Beacon project earns one unlock for a Beacon-locked reward."}
            </p>
          </div>
          {hasBeaconItems ? (
            <button type="button" className={tierBtn(beaconOnly)} onClick={() => setBeaconOnly((v) => !v)}>
              {beaconOnly ? "SHOW ALL ITEMS" : "SHOW BEACON REWARDS"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <input
          className={cn(field, "min-w-[200px] flex-1")}
          type="search"
          placeholder="Search the shelves..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search items"
        />
        <select className={cn(selectField, "w-auto min-w-[150px]")} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="featured">FEATURED</option>
          <option value="cheap">PRICE ↑</option>
          <option value="pricey">PRICE ↓</option>
          <option value="name">A–Z</option>
        </select>
        <RegionSelect region={region} />
      </div>

      <div className={tiersRow}>
        {TIERS.map(([v, l]) => (
          <button key={v} type="button" className={tierBtn(tier === v)} onClick={() => setTier(v)}>
            {l}
          </button>
        ))}
        <button type="button" className={tierBtn(unlockedOnly)} onClick={() => setUnlockedOnly((v) => !v)}>
          UNLOCKED ONLY
        </button>
        <button type="button" className={tierBtn(savedOnly)} onClick={() => setSavedOnly((v) => !v)}>
          ★ SAVED
        </button>
        {hasBeaconItems ? (
          <button type="button" className={tierBtn(beaconOnly)} onClick={() => setBeaconOnly((v) => !v)}>
            BEACON REWARDS
          </button>
        ) : null}
      </div>
      <div className={tiersRow}>
        {CATEGORIES.map(([v, l]) => (
          <button key={v} type="button" className={tierBtn(category === v)} onClick={() => setCategory(v)}>
            {l}
          </button>
        ))}
      </div>

      {err ? <Notice tone="bad" className="mb-4">Couldn&apos;t update that save: {err}</Notice> : null}

      {trophies.length > 0 ? (
        <>
          <div className="mt-[8px] mb-[16px] flex flex-wrap items-baseline gap-[12px]">
            <span className="font-pixel text-[18px] tracking-[1px] text-teal">✦ RESTORATION REWARDS</span>
            <span className="text-[12.5px] text-faint">Earned by leveling up, not for sale</span>
          </div>
          <div className={autoGrid}>
            {trophies.map((i) => (
              <TrophyCard key={i.id} item={i} xp={xp} state={trophyState(i, xp, claimedSet)} />
            ))}
          </div>
          <div className={divider} />
        </>
      ) : null}

      {list.length > 0 ? (
        <div className={autoGrid}>
          {list.map((i) => (
            <ItemCard key={i.id} item={i} canAfford={canAfford(i)} rates={rates} onToggleSave={() => toggleSave(i)} />
          ))}
        </div>
      ) : null}

      {list.length + trophies.length === 0 ? (
        <div className={emptyNote}>NOTHING ON THESE SHELVES.<br />TRY ANOTHER FILTER.</div>
      ) : null}
    </div>
  );
}
