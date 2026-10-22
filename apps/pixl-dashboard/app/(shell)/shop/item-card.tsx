"use client";

import Image from "next/image";
import Link from "next/link";
import { bbstrip } from "@/components/markdown";
import { SafeImage } from "@/components/safe-image";
import { card, dotVariants } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { EarnRates } from "../calc/estimates";
import { hoursHint } from "./hours-hint";
import { PriceTag } from "./price-tag";
import { basePrice, isDiscounted, isPending, lockReason, metaBits, originalBasePrice, type ShopItem } from "./shop-lib";
import {
  beaconTag,
  discountTag,
  imgPlaceholder,
  itemDesc,
  itemImg,
  itemMeta,
  itemName,
  priceClass,
  priceHours,
  priceWrap,
  slotImg,
} from "./shop-styles";

/** Ribbon hanging off the top edge of a card. */
const cornerTag = "absolute -top-[9px] z-2 px-[7px] py-[3px] font-pixel text-[10px] tracking-[1px] text-btn-ink";
// LIMITED cards keep their gold ring through the card's hover/active lift.
const limitedRing = cn(
  "border-gold shadow-[0_0_0_1px_var(--gold),var(--drop)]",
  "hover:shadow-[0_0_0_1px_var(--gold),var(--drop)] active:shadow-[0_0_0_1px_var(--gold),var(--drop)]",
);

function Foot({ item, canAfford, hint }: { item: ShopItem; canAfford: boolean; hint: string }) {
  if (item.locked && item.unlockPending) {
    return (
      <div className={priceWrap}>
        <span className={priceClass(true)}>NOT AVAILABLE</span>
        <span className={priceHours}>Available soon</span>
      </div>
    );
  }
  if (item.locked) {
    return (
      <div className={priceWrap}>
        <PriceTag amount={basePrice(item)} from={!!item.config_options} cant locked />
        <span className={priceHours}>{lockReason(item)}</span>
      </div>
    );
  }
  if (isPending(item)) {
    return (
      <div className={priceWrap}>
        <span className={priceClass(true)}>NOT AVAILABLE</span>
        <span className={priceHours}>{item.name === "Food Grant" ? "Available soon" : "Coming soon to this region"}</span>
      </div>
    );
  }
  return (
    <>
      <div className={priceWrap}>
        {isDiscounted(item) ? <span className={discountTag}>-{Math.round(Number(item.discount_percent))}% OFF</span> : null}
        <PriceTag
          amount={basePrice(item)}
          from={!!item.config_options}
          cant={!canAfford}
          was={isDiscounted(item) ? originalBasePrice(item) : undefined}
        />
        {hint ? <span className={priceHours}>{hint}</span> : null}
        {item.beacon_locked ? (
          <span className={beaconTag}>
            <Image
              src="/img/pixl-ui/icon_beacon.png"
              alt=""
              aria-hidden
              width={10}
              height={10}
              className="size-[10px] shrink-0 [image-rendering:pixelated]"
            />
            BEACON · {item.beaconAvailable ?? 0} LEFT
          </span>
        ) : null}
      </div>
      <span
        className={dotVariants({ tone: canAfford ? "on" : "off" })}
        title={canAfford ? "You can afford this" : "Keep shipping!"}
      />
    </>
  );
}

export function ItemCard({
  item,
  canAfford,
  rates,
  onToggleSave,
}: {
  item: ShopItem;
  canAfford: boolean;
  /** Per-hour earn rates computed server side (calc/estimates.ts). */
  rates: EarnRates | null;
  onToggleSave: () => void;
}) {
  const meta = metaBits(item);
  return (
    <div
      className={cn(
        card,
        "relative flex flex-col gap-[10px] px-[13px] pt-[13px] pb-[15px]",
        item.limited && limitedRing,
        item.locked && "brightness-[.82] saturate-[.45]",
      )}
    >
      <Link href={`/shop/${item.id}`} className="absolute inset-0 z-1" aria-label={item.name} />
      {item.locked && !item.unlockPending ? <div className={cn(cornerTag, "left-[9px] bg-faint")}>LOCKED</div> : null}
      {item.limited ? <div className={cn(cornerTag, "right-[9px] bg-gold")}>LIMITED</div> : null}
      {item.is_new && !item.limited ? <div className={cn(cornerTag, "right-[9px] bg-good")}>NEW</div> : null}
      {item.stock && item.stock.length ? (
        <div className={cn(cornerTag, "left-[9px] bg-teal")}>{item.stock[0].total} ONLY</div>
      ) : null}
      <div className={cn(itemImg, item.locked && "opacity-70")}>
        <SafeImage src={item.image_url} className={slotImg} fallback={<span className={imgPlaceholder} />} />
        <button
          type="button"
          className={cn(
            "absolute top-[6px] right-[6px] z-3 flex size-[26px] items-center justify-center",
            "border-2 border-stroke bg-panel text-[14px] leading-none text-faint hover:border-gold hover:text-gold",
            item.saved && "border-gold text-gold",
          )}
          title={item.saved ? "Saved, click to unsave" : "Save this item"}
          aria-pressed={!!item.saved}
          onClick={onToggleSave}
        >
          {item.saved ? "★" : "☆"}
        </button>
      </div>
      <div className={itemName}>{item.name}</div>
      <div className={itemDesc}>{bbstrip(item.description || "")}</div>
      {meta.length ? <div className={itemMeta}>{meta.join(" · ")}</div> : null}
      <div className="mt-auto flex items-center justify-between">
        <Foot item={item} canAfford={canAfford} hint={hoursHint(basePrice(item), rates)} />
      </div>
    </div>
  );
}
