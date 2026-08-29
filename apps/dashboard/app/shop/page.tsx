import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm } from "@/lib/guard";
import { listShopItems, listShopOptionStock, listSidequests, SHOP_REGIONS, SHOP_REGION_LABELS, SHOP_CATEGORIES, SHOP_CATEGORY_LABELS, type ShopRegion } from "@/lib/db";
import { addShopItem, toggleShopItem, deleteShopItem, updateShopItem, updateShopItemPrices } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Disclosure } from "@/app/_components/Disclosure";
import { OptionsEditor } from "@/app/_components/OptionsEditor";
import { AddShopItemForm } from "@/app/_components/AddShopItemForm";
import { BulkUploadShopItemsForm } from "@/app/_components/BulkUploadShopItemsForm";
import { parseOptionGroups } from "@/lib/shopOptions";
import { config } from "@/app/_generated/config";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination";

export const dynamic = "force-dynamic";

const PER = 8;

const FILE_INPUT =
  "block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; region?: string; q?: string }>;
}) {
  const access = await requirePagePerm(["shop"]);
  const { page, region: rawRegion, q } = await searchParams;
  const region: ShopRegion = (SHOP_REGIONS as readonly string[]).includes(rawRegion ?? "")
    ? (rawRegion as ShopRegion)
    : "US";
  const query = (q ?? "").trim().toLowerCase();
  // Trophies (unlock_xp > 0, e.g. the 3D Printed Blahaj) are earned by
  // leveling up, not bought with pixels or tied to a region — pull them out
  // into their own section regardless of which region tab is selected.
  const [regionItems, everyItem, allSidequests] = await Promise.all([
    listShopItems(region),
    listShopItems(),
    listSidequests(),
  ]);
  // Active Trials the admin can gate a shop item behind (unlock via completion).
  const gateTrials = allSidequests.filter((q) => q.active);
  const trophies = everyItem.filter((i) => i.unlock_xp > 0);
  // Every region's price for a given item, by name, for the "edit prices in
  // every region" mini-form below , so an admin can reprice all 7 regions in
  // one place instead of switching the region tab per edit. A region with no
  // row for this item (never stocked there) just shows 0/not-available.
  const pricesByName = new Map<string, Partial<Record<ShopRegion, number>>>();
  for (const it of everyItem) {
    if (it.unlock_xp > 0) continue;
    const m = pricesByName.get(it.name) ?? {};
    m[it.region] = it.price;
    pricesByName.set(it.name, m);
  }
  let allItems = regionItems.filter((i) => i.unlock_xp === 0);
  if (query) {
    allItems = allItems.filter(
      (i) => i.name.toLowerCase().includes(query) || i.description?.toLowerCase().includes(query),
    );
  }
  const pages = Math.max(1, Math.ceil(allItems.length / PER));
  const cur = Math.min(Math.max(parseInt(page ?? "1", 10) || 1, 1), pages);
  const start = (cur - 1) * PER;
  const items = allItems.slice(start, start + PER);
  const stockByItem = await listShopOptionStock(items.map((i) => i.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Shop</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Items shown in the in-game Pixl shop. Purchases aren&apos;t enabled yet , players can
          only browse, so feel free to stock the shelves.
        </p>
      </div>

      {trophies.length > 0 && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-3">
            🏆 Trophies · earned by leveling up, not bought or region-scoped
          </div>
          <div className="grid gap-4">
            {trophies.map((item) => (
              <Card key={item.id} className={`p-4 gap-4 flex-row ${item.active ? "" : "opacity-60"}`}>
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-20 h-20 rounded-lg object-cover border border-border shrink-0 [image-rendering:pixelated]"
                  />
                ) : (
                  <span className="grid place-items-center w-20 h-20 rounded-lg bg-muted border border-border shrink-0 text-2xl">
                    🏆
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{item.name}</span>
                    <Badge variant="secondary" className="tabular-nums">
                      Unlocks at {item.unlock_xp} XP
                    </Badge>
                    {!item.active && <Badge variant="secondary">hidden</Badge>}
                  </div>
                  {item.description && (
                    <div className="text-sm text-muted-foreground mt-1">{item.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <form action={toggleShopItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="active" value={item.active ? "0" : "1"} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText={item.active ? "Hiding…" : "Showing…"}
                      >
                        {item.active ? "Hide" : "Show"}
                      </PendingButton>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SHOP_REGIONS.map((r) => (
            <Link
              key={r}
              href={`/shop?region=${r}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                r === region
                  ? "bg-brand text-white border-transparent"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {SHOP_REGION_LABELS[r]}
            </Link>
          ))}
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="region" value={region} />
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search item names…"
            className="w-full min-w-0 max-w-64 text-sm"
          />
          {q && (
            <Link
              href={`/shop?region=${region}`}
              className="text-sm text-muted-foreground hover:text-foreground self-center"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <Card className="p-5 md:p-6 gap-0">
        <div className="text-base font-semibold mb-4">Add an item to {SHOP_REGION_LABELS[region]}</div>
        <AddShopItemForm action={addShopItem} region={region} />
        <Disclosure summary="Bulk upload from CSV" className="mt-5">
          <BulkUploadShopItemsForm region={region} />
        </Disclosure>
      </Card>

      <div>
        <div className="text-sm font-medium text-muted-foreground mb-3">
          {allItems.length} item{allItems.length === 1 ? "" : "s"} in {SHOP_REGION_LABELS[region]} ·
          only active ones show in game
        </div>
        {allItems.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            Empty shelves. Add the first item above.
          </Card>
        ) : (
          <div className="grid gap-4">
            {items.map((item) => (
              <Card key={item.id} className={`p-4 gap-4 flex-row ${item.active ? "" : "opacity-60"}`}>
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-20 h-20 rounded-lg object-cover border border-border shrink-0 [image-rendering:pixelated]"
                  />
                ) : (
                  <span className="grid place-items-center w-20 h-20 rounded-lg bg-muted border border-border shrink-0 text-2xl">
                    🛍️
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{item.name}</span>
                    <Badge variant="success" className="tabular-nums">
                      {item.price} px
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="tabular-nums"
                      title="What fulfillers can spend sourcing this item"
                    >
                      ${(item.price * config.economy.pixelValueUsd).toFixed(2)}
                    </Badge>
                    <Badge variant="secondary">
                      {SHOP_CATEGORY_LABELS[item.category] ?? SHOP_CATEGORY_LABELS.other}
                    </Badge>
                    {!item.active && <Badge variant="secondary">hidden</Badge>}
                  </div>
                  {item.description && (
                    <div className="text-sm text-muted-foreground mt-1">{item.description}</div>
                  )}
                  {item.options.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {parseOptionGroups(item.options).map((g, gi) => (
                        <div key={gi} className="flex items-center gap-1.5 flex-wrap">
                          {g.name && (
                            <span className="text-xs font-medium text-muted-foreground">{g.name}:</span>
                          )}
                          {g.choices.map((c) => (
                            <Badge key={c} variant="secondary">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {(stockByItem.get(item.id)?.length ?? 0) > 0 && (
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-xs">
                      <span className="font-medium text-muted-foreground">Stock:</span>
                      {stockByItem.get(item.id)!.map((s) => (
                        <Badge key={s.choice} variant={s.remaining <= 0 ? "destructive" : "secondary"}>
                          {s.choice} {s.remaining}/{s.total}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <form action={toggleShopItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="active" value={item.active ? "0" : "1"} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText={item.active ? "Hiding…" : "Showing…"}
                      >
                        {item.active ? "Hide" : "Show"}
                      </PendingButton>
                    </form>
                    <form action={deleteShopItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText="Deleting…"
                        confirm={`Delete "${item.name}" from the shop? This can't be undone.`}
                        className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
                      >
                        Delete
                      </PendingButton>
                    </form>
                  </div>
                  <Disclosure summary="Edit item" className="mt-3">
                    <form action={updateShopItem} className="space-y-3">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="original_name" value={item.name} />
                      <div className="grid grid-cols-[1fr_6.5rem] gap-3">
                        <Label className="block font-normal">
                          <span className="block text-xs font-medium text-muted-foreground mb-1">Name</span>
                          <Input
                            name="name"
                            required
                            maxLength={60}
                            defaultValue={item.name}
                            className="w-full text-sm"
                          />
                        </Label>
                        <Label className="block font-normal">
                          <span className="block text-xs font-medium text-muted-foreground mb-1">Price (px)</span>
                          <Input
                            name="price"
                            type="number"
                            min={0}
                            required
                            defaultValue={item.price}
                            className="w-full text-sm"
                          />
                        </Label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Label className="block font-normal">
                          <span className="block text-xs font-medium text-muted-foreground mb-1">Region</span>
                          <select
                            name="region"
                            defaultValue={item.region}
                            className="w-full text-sm h-9 rounded-md border border-border bg-background px-3"
                          >
                            {SHOP_REGIONS.map((r) => (
                              <option key={r} value={r}>
                                {SHOP_REGION_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </Label>
                        <Label className="block font-normal">
                          <span className="block text-xs font-medium text-muted-foreground mb-1">Category</span>
                          <select
                            name="category"
                            defaultValue={item.category}
                            className="w-full text-sm h-9 rounded-md border border-border bg-background px-3"
                          >
                            {SHOP_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {SHOP_CATEGORY_LABELS[c]}
                              </option>
                            ))}
                          </select>
                        </Label>
                      </div>
                      <Label className="block font-normal">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Description</span>
                        <Input
                          name="description"
                          maxLength={300}
                          defaultValue={item.description}
                          className="w-full text-sm"
                        />
                      </Label>
                      <div className="block">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">Options</span>
                        <OptionsEditor name="options" initial={item.options} />
                      </div>
                      <div className="block">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">
                          Unlock via Trial (locked until the player ships ONE of the ticked Trials; none = buyable)
                        </span>
                        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-md border border-border p-2">
                          {gateTrials.length === 0 && (
                            <span className="text-xs text-muted-foreground">No active Trials.</span>
                          )}
                          {gateTrials.map((q) => (
                            <label key={q.id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                name="unlock_trials"
                                value={q.id}
                                defaultChecked={(item.unlock_trial_ids ?? [])
                                  .map(Number)
                                  .includes(q.id)}
                                className="h-4 w-4 rounded border-border accent-brand"
                              />
                              <span>
                                {q.name}
                                {q.region ? (
                                  <span className="text-muted-foreground"> · {q.region}</span>
                                ) : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <Label className="block font-normal">
                        <span className="block text-xs font-medium text-muted-foreground mb-1">
                          Replace image (optional , leave empty to keep the current one)
                        </span>
                        <input
                          name="image"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className={FILE_INPUT}
                        />
                      </Label>
                      <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          name="apply_all_regions"
                          value="1"
                          className="mt-0.5 h-4 w-4 rounded border-border accent-brand"
                        />
                        <span>
                          Apply <span className="font-medium text-foreground">name, description &amp; category</span> to
                          this item in every region (price, options &amp; image stay per-region)
                        </span>
                      </label>
                      <PendingButton
                        className="bg-brand text-white border-transparent"
                        pendingText="Saving…"
                      >
                        Save changes
                      </PendingButton>
                    </form>

                    <Disclosure summary="Edit price in every region" className="mt-3">
                      <form action={updateShopItemPrices} className="space-y-3">
                        <input type="hidden" name="item_name" value={item.name} />
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {SHOP_REGIONS.map((r) => (
                            <Label key={r} className="block font-normal">
                              <span className="block text-xs font-medium text-muted-foreground mb-1">
                                {SHOP_REGION_LABELS[r]}
                              </span>
                              <Input
                                name={`price_${r}`}
                                type="number"
                                min={0}
                                defaultValue={pricesByName.get(item.name)?.[r] ?? 0}
                                className="w-full text-sm"
                              />
                            </Label>
                          ))}
                        </div>
                        <span className="block text-xs text-muted-foreground">
                          0 means not for sale in that region. Only prices change here , name,
                          description, options &amp; image stay per-region, edit those above.
                        </span>
                        <PendingButton
                          className="bg-brand text-white border-transparent"
                          pendingText="Saving…"
                        >
                          Save prices
                        </PendingButton>
                      </form>
                    </Disclosure>
                  </Disclosure>
                </div>
              </Card>
            ))}
          </div>
        )}

        {allItems.length > PER && (
          <div className="flex items-center justify-between gap-3 mt-4 text-sm">
            <span className="text-muted-foreground">
              Showing {start + 1}–{Math.min(start + PER, allItems.length)} of {allItems.length}
            </span>
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink
                    href={`/shop?region=${region}&page=${cur - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                    aria-label="Previous page"
                    className={cur <= 1 ? "pointer-events-none opacity-40" : ""}
                  >
                    ←
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <span className="px-2 text-muted-foreground tabular-nums">
                    {cur} / {pages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink
                    href={`/shop?region=${region}&page=${cur + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                    aria-label="Next page"
                    className={cur >= pages ? "pointer-events-none opacity-40" : ""}
                  >
                    →
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </div>
    </div>
  );
}
