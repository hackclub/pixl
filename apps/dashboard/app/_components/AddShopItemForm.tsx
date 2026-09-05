"use client";

import { useState } from "react";
import { PendingButton } from "@/app/_components/PendingButton";
import { OptionsEditor } from "@/app/_components/OptionsEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SHOP_REGIONS, SHOP_REGION_LABELS, type ShopRegion } from "@/lib/shopRegions";
import { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS } from "@/lib/shopCategories";
import { config } from "@/app/_generated/config";

const FILE_INPUT =
  "block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80";

export function AddShopItemForm({
  action,
  region,
}: {
  action: (fd: FormData) => void;
  region: ShopRegion;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [regions, setRegions] = useState<ShopRegion[]>([region]);
  // Per-region price overrides, keyed by region. A region with no entry here
  // just uses the shared `price` field when the form submits.
  const [regionPrices, setRegionPrices] = useState<Partial<Record<ShopRegion, string>>>({});

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setImage(f ? URL.createObjectURL(f) : null);
  }

  // Typing a dollar amount fills the pixel price for you (pixelValueUsd is
  // the same rate the game/shop use everywhere else), rounded UP to the
  // nearest multiple of 5 - every shop price is a multiple of 5 by
  // convention. The pixel field stays directly editable too, for
  // fine-tuning or pasting a price someone already worked out in pixels.
  function onUsdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const usd = e.target.value;
    setPriceUsd(usd);
    const n = Number(usd);
    if (usd.trim() !== "" && Number.isFinite(n) && n >= 0)
      setPrice(String(Math.ceil(n / config.economy.pixelValueUsd / 5) * 5));
  }

  function toggleRegion(r: ShopRegion) {
    setRegions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  const allSelected = regions.length === SHOP_REGIONS.length;

  return (
    <form action={action} className="grid lg:grid-cols-[1fr_15rem] gap-6">
      <input type="hidden" name="regions" value={regions.join(",")} />
      <div className="space-y-5 min-w-0">
        <div className="grid sm:grid-cols-[1fr_8rem_8rem] gap-4">
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Name</span>
            <Input
              name="name"
              required
              maxLength={60}
              placeholder="Holo Sticker"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm"
            />
          </Label>
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Price ($)</span>
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="4.20"
              value={priceUsd}
              onChange={onUsdChange}
              className="w-full text-sm"
            />
            <span className="block text-xs text-muted-foreground mt-1">Fills the px price →</span>
          </Label>
          <Label className="block font-normal">
            <span className="block text-sm font-medium mb-1.5">Price (px)</span>
            <Input
              name="price"
              type="number"
              min={0}
              required
              placeholder="60"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full text-sm"
            />
            <span className="block text-xs text-muted-foreground mt-1">Default for any region below with no override.</span>
          </Label>
        </div>

        <div className="block">
          <div className="flex items-center justify-between mb-1.5">
            <span className="block text-sm font-medium">Regions</span>
            <button
              type="button"
              onClick={() => setRegions(allSelected ? [region] : [...SHOP_REGIONS])}
              className="text-xs text-brand hover:underline"
            >
              {allSelected ? "Just this region" : "Select all regions"}
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3">
            {SHOP_REGIONS.map((r) => {
              const checked = regions.includes(r);
              return (
                <div key={r} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRegion(r)}
                      className="size-4 shrink-0"
                    />
                    <span className="truncate">{SHOP_REGION_LABELS[r]}</span>
                  </label>
                  {checked && (
                    <Input
                      type="number"
                      min={0}
                      placeholder={price || "px"}
                      value={regionPrices[r] ?? ""}
                      onChange={(e) =>
                        setRegionPrices((prev) => ({ ...prev, [r]: e.target.value }))
                      }
                      name={regionPrices[r] ? `price_${r}` : undefined}
                      className="w-20 h-7 text-xs shrink-0"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <span className="block text-xs text-muted-foreground mt-1">
            Pick the regions to add this to. Type a price next to a region to override the default for it.
          </span>
        </div>

        <Label className="block font-normal">
          <span className="block text-sm font-medium mb-1.5">Category</span>
          <select
            name="category"
            defaultValue="other"
            className="w-full h-9 text-sm rounded-md border border-border bg-background px-3"
          >
            {SHOP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SHOP_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Label>

        <Label className="block font-normal">
          <span className="block text-sm font-medium mb-1.5">Description</span>
          <Input
            name="description"
            maxLength={300}
            placeholder="Holographic, shimmery. Looks great on a laptop."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-sm"
          />
        </Label>

        <div className="block">
          <span className="block text-sm font-medium mb-1.5">Options</span>
          <OptionsEditor name="options" />
          <span className="block text-xs text-muted-foreground mt-1">
            Optional , groups like Color or Storage, each with comma-separated choices.
          </span>
        </div>

        <Label className="block font-normal">
          <span className="block text-sm font-medium mb-1.5">Image</span>
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className={FILE_INPUT} />
          <span className="block text-xs text-muted-foreground mt-1">Optional , PNG/JPG/WebP, max 4 MB.</span>
        </Label>

        <div className="flex justify-start">
          <PendingButton
            className="bg-brand text-white border-transparent"
            pendingText="Adding… (uploading can take a few seconds)"
          >
            Add item
          </PendingButton>
        </div>
      </div>

      {/* live preview , what the card looks like in the shop */}
      <div className="lg:sticky lg:top-14 self-start">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Preview</div>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="aspect-square rounded-lg border border-border bg-gradient-to-b from-muted/40 to-muted/10 flex items-center justify-center overflow-hidden mb-3">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="w-full h-full object-cover [image-rendering:pixelated]" />
            ) : (
              <span className="text-3xl opacity-50">🎁</span>
            )}
          </div>
          <div className="font-semibold text-sm truncate">{name || "Item name"}</div>
          <div className="text-xs text-muted-foreground line-clamp-2 min-h-8 mt-0.5">
            {description || "Description shows up here."}
          </div>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 px-2 py-0.5 text-xs font-semibold tabular-nums">
              {price ? Number(price).toLocaleString() : "0"} px
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
