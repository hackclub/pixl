// Class strings shared by the shop catalog cards and the item detail page.
import { cn } from "@/lib/cn";

/** Pixel-art image slot on a catalog card. */
export const itemImg = cn(
  "relative flex h-[148px] items-center justify-center overflow-hidden",
  "border-2 border-stroke bg-(--img-slot) [image-rendering:pixelated]",
);
/** The image inside an image slot. */
export const slotImg = "max-h-full max-w-full";
/** Diamond placeholder when an item has no (allowed) image. */
export const imgPlaceholder = "size-[40px] bg-stroke opacity-50 [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";

export const itemName = "font-pixel text-[17px] tracking-[.5px] text-ink";
export const itemDesc = "line-clamp-2 min-h-[2.7em] text-[14px] leading-[1.5] text-dim";
export const itemMeta = "text-[11px] font-medium text-faint";

export const priceWrap = "flex flex-col gap-px";
export function priceClass(cant?: boolean): string {
  return cn(
    "flex flex-wrap items-center gap-[7px] font-sans text-[17px] font-bold tabular-nums text-gold",
    "[&>img]:size-[16px]",
    cant && "text-bad",
  );
}
export const priceWas = "ml-[5px] text-[11px] font-medium text-faint line-through";
export const priceHours = "max-w-[220px] text-[10.5px] leading-[1.4] font-medium text-faint";
export const discountTag = "self-start bg-bad px-[5px] py-[2px] font-pixel text-[9px] tracking-[.5px] text-btn-ink";

/** Beacon reward flag on a catalog card / item detail. */
export const beaconTag = cn(
  "inline-flex w-fit items-center gap-[5px] border-2 border-stroke bg-gold px-[6px] py-[2px]",
  "font-pixel text-[9px] tracking-[.6px] text-btn-ink",
);

// Item detail page.
export const detailRow = "grid grid-cols-[minmax(0,340px)_1fr] gap-[24px] max-[760px]:grid-cols-1";
export const detailImg = cn(
  "flex aspect-square items-center justify-center",
  "border-2 border-stroke bg-(--img-slot) [image-rendering:pixelated]",
);
export const detailInfo = "flex min-w-0 flex-col gap-[14px]";
export const detailName = "font-pixel text-[28px] leading-[1.1] text-ink";
export const detailDesc = "leading-[1.6] whitespace-pre-wrap text-dim";
export const detailPriceSize = "text-[22px] [&>img]:size-[20px]";
export const chipRow = "flex flex-wrap gap-[6px]";
export const btnRow = "flex flex-wrap gap-[8px]";
/** Small pixel-font caption over a control (option group names, QTY, note). */
export const smallCaps = "font-pixel text-[12px] tracking-[1.5px] text-dim";
