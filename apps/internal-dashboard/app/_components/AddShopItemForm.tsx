"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { OptionsEditor } from "@/app/_components/OptionsEditor";
import { ShopConfigEditor } from "@/app/_components/ShopConfigEditor";
import { ActionButton, Badge, Button, Card, Checkbox, Field, Icon, Input, Muted, NativeSelect } from "@/app/_ui/ui";
import { SHOP_REGIONS, SHOP_REGION_LABELS, type ShopRegion } from "@/lib/shopRegions";
import { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS } from "@/lib/shopCategories";
import { config } from "@/app/_generated/config";

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
  // Per-region sale percentages, keyed by region. A region with no entry here
  // is added at full price (no sale).
  const [regionSales, setRegionSales] = useState<Partial<Record<ShopRegion, string>>>({});
  // Price-changing options (config_options), optional. The item's own
  // price/region overrides above double as each region's base price, so
  // there's no separate base-price field here, just the reference link.
  const [configEnabled, setConfigEnabled] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setImage(f ? URL.createObjectURL(f) : null);
  }

  // Typing a dollar amount fills the pixel price (same pixelValueUsd rate the
  // game uses), rounded UP to the nearest multiple of 5, since every shop
  // price is a multiple of 5 by convention. The pixel field stays editable.
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
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <input type="hidden" name="regions" value={regions.join(",")} />
      <div className="flex min-w-0 flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem_8rem]">
          <Field label="Name">
            <Input
              name="name"
              required
              maxLength={60}
              placeholder="Holo Sticker"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Price ($)" hint="Fills the px price">
            <Input type="number" min={0} step="0.01" placeholder="4.20" value={priceUsd} onChange={onUsdChange} />
          </Field>
          <Field label="Price (px)" hint="Default for every region">
            <Input
              name="price"
              type="number"
              min={0}
              required
              placeholder="60"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="hc-label">Regions</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRegions(allSelected ? [region] : [...SHOP_REGIONS])}
            >
              {allSelected ? "Just this region" : "Select all regions"}
            </Button>
          </div>
          <div className="hc-panel grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {SHOP_REGIONS.map((r) => {
              const checked = regions.includes(r);
              return (
                <div key={r} className="flex items-center gap-2">
                  <Checkbox
                    label={SHOP_REGION_LABELS[r]}
                    checked={checked}
                    onChange={() => toggleRegion(r)}
                    className="min-w-0 flex-1"
                  />
                  {checked && (
                    <>
                      <Input
                        type="number"
                        min={0}
                        placeholder={price || "px"}
                        value={regionPrices[r] ?? ""}
                        onChange={(e) => setRegionPrices((prev) => ({ ...prev, [r]: e.target.value }))}
                        name={regionPrices[r] ? `price_${r}` : undefined}
                        className="h-7 w-20 shrink-0 text-xs"
                        aria-label={`${SHOP_REGION_LABELS[r]} price in pixels`}
                        title="Price in pixels"
                      />
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        placeholder="sale %"
                        value={regionSales[r] ?? ""}
                        onChange={(e) => setRegionSales((prev) => ({ ...prev, [r]: e.target.value }))}
                        name={regionSales[r] ? `discount_${r}` : undefined}
                        className="h-7 w-16 shrink-0 text-xs"
                        aria-label={`${SHOP_REGION_LABELS[r]} sale percent off`}
                        title="Sale % off"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <Muted className="text-xs">
            Pick the regions to add this to. The first box next to a region overrides its price, the second puts
            that region&apos;s copy on sale (% off).
          </Muted>
        </div>

        <Field label="Category">
          <NativeSelect name="category" defaultValue="other">
            {SHOP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SHOP_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Description">
          <Input
            name="description"
            maxLength={300}
            placeholder="Holographic, shimmery. Looks great on a laptop."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="hc-label">
            Options
            <span className="hc-label-hint">Optional. Groups like Color or Storage, each with comma-separated choices.</span>
          </span>
          <OptionsEditor name="options" />
        </div>

        <div className="hc-panel flex flex-col gap-2">
          <Checkbox
            label="Price-changing options"
            checked={configEnabled}
            onChange={(e) => setConfigEnabled(e.target.checked)}
          />
          <Muted className="text-xs">
            Unlike Options above, these change the price, e.g. a Storage group where &quot;256GB&quot; costs more than
            &quot;128GB&quot;. Set a price per region if it should differ.
          </Muted>
          {configEnabled && (
            <div className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="config_enable" value="1" />
              <Input
                name="config_reference_url"
                type="url"
                placeholder="https://... (reference listing for the base price)"
              />
              <ShopConfigEditor
                name="config_groups"
                initialGroups={[]}
                pixelValueUsd={config.economy.pixelValueUsd}
                regions={regions}
                regionLabels={SHOP_REGION_LABELS}
              />
            </div>
          )}
        </div>

        <Field label="Image" hint="Optional. PNG, JPG or WebP, max 4 MB.">
          <input
            name="image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            className="hc-file"
          />
        </Field>

        <div>
          <ActionButton pendingLabel="Adding... (uploading can take a few seconds)" icon="plus">
            Add item
          </ActionButton>
        </div>
      </div>

      {/* Live preview: roughly what the card looks like in the shop. */}
      <div className="self-start lg:sticky lg:top-20">
        <div className="hc-eyebrow mb-2">Preview</div>
        <Card padding="compact" sunken>
          <div className="mb-3 flex aspect-square items-center justify-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]">
            {image ? (
              <img src={image} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" />
            ) : (
              <Icon glyph="photo" size={40} className="hc-muted" />
            )}
          </div>
          <div className="truncate text-sm font-bold">{name || "Item name"}</div>
          <p className="hc-caption mt-0.5 line-clamp-2 min-h-8 text-xs">{description || "Description shows up here."}</p>
          <div className="mt-2">
            <Badge tone="success">{price ? Number(price).toLocaleString() : "0"} px</Badge>
          </div>
        </Card>
      </div>
    </form>
  );
}
