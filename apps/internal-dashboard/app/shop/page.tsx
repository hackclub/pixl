/* eslint-disable @next/next/no-img-element */
import { requirePage } from "@/lib/guard";
import {
  listShopItems,
  listPersonalShopItems,
  listShopOptionStock,
  listSidequests,
  SHOP_REGIONS,
  SHOP_REGION_LABELS,
  SHOP_CATEGORIES,
  SHOP_CATEGORY_LABELS,
  type ShopRegion,
  type ShopItemRow,
} from "@/lib/db";
import { addShopItem, toggleShopItem, deleteShopItem, updateShopItem, updateShopItemPrices } from "@/app/actions";
import { OptionsEditor } from "@/app/_components/OptionsEditor";
import { AddShopItemForm } from "@/app/_components/AddShopItemForm";
import { PersonalShopItems } from "@/app/_components/PersonalShopItems";
import { ShopItemEditConfigurator } from "@/app/_components/ShopItemEditConfigurator";
import { BulkUploadShopItemsForm } from "@/app/_components/BulkUploadShopItemsForm";
import { parseOptionGroups } from "@/lib/shopOptions";
import { config } from "@/app/_generated/config";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  Details,
  EmptyState,
  Field,
  Flash,
  Icon,
  Input,
  LinkTabs,
  Muted,
  NativeSelect,
  PageHeader,
  Pagination,
  type GlyphName,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const PER = 8;

function ItemThumb({ src, glyph }: { src: string | null | undefined; glyph: GlyphName }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-20 w-20 shrink-0 rounded-md border border-[var(--border)] object-cover [image-rendering:pixelated]"
      />
    );
  }
  return (
    <span className="hc-muted grid h-20 w-20 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--sunken)]">
      <Icon glyph={glyph} size={32} />
    </span>
  );
}

function ToggleForm({ item }: { item: ShopItemRow }) {
  return (
    <form action={toggleShopItem}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="active" value={item.active ? "0" : "1"} />
      <ActionButton
        variant="outline"
        size="sm"
        icon={item.active ? "private" : "view"}
        pendingLabel={item.active ? "Hiding..." : "Showing..."}
      >
        {item.active ? "Hide" : "Show"}
      </ActionButton>
    </form>
  );
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; region?: string; q?: string; personalError?: string; shopError?: string }>;
}) {
  await requirePage("owner");
  const { page, region: rawRegion, q, personalError, shopError } = await searchParams;
  const region: ShopRegion = (SHOP_REGIONS as readonly string[]).includes(rawRegion ?? "")
    ? (rawRegion as ShopRegion)
    : "US";
  const query = (q ?? "").trim().toLowerCase();
  // Trophies (unlock_xp > 0, e.g. the 3D Printed Blahaj) are earned by
  // leveling up, not bought with pixels or tied to a region, so they get their
  // own section whichever region tab is selected.
  const [regionItems, everyItem, allSidequests, personalItems] = await Promise.all([
    listShopItems(region),
    listShopItems(),
    listSidequests(),
    listPersonalShopItems(),
  ]);
  // Active Trials the admin can gate a shop item behind (unlock via completion).
  const gateTrials = allSidequests.filter((t) => t.active);
  const trophies = everyItem.filter((i) => i.unlock_xp > 0);
  // Every region's price and sale for a given item, by name, for the "edit
  // price in every region" form, so an admin can reprice and discount all
  // regions in one place. A region with no row for this item just shows 0 (not
  // for sale) and no sale.
  const pricesByName = new Map<string, Partial<Record<ShopRegion, { price: number; discount: number }>>>();
  for (const it of everyItem) {
    if (it.unlock_xp > 0) continue;
    const m = pricesByName.get(it.name) ?? {};
    m[it.region] = { price: it.price, discount: it.discount_percent };
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
  const qParam = q ? `&q=${encodeURIComponent(q)}` : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shop"
        description="Items in the in-game Pixl shop, per region. Only active items show in game."
        actions={
          <ButtonLink href="/shop-detail" variant="outline" size="sm" icon="list">
            Regional pricing
          </ButtonLink>
        }
      />

      <Flash error={shopError} />

      {trophies.length > 0 && (
        <Card padding="flush">
          <CardHeader title="Trophies" icon="badge-award" count={trophies.length} />
          <p className="hc-caption px-4 pt-3 text-sm">Earned by leveling up, not bought or tied to a region.</p>
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {trophies.map((item) => (
              <div key={item.id} className={`flex gap-4 px-4 py-4 ${item.active ? "" : "opacity-60"}`}>
                <ItemThumb src={item.image_url} glyph="badge-award" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{item.name}</span>
                    <Badge tone="purple">Unlocks at {item.unlock_xp} XP</Badge>
                    {!item.active && <Badge>Hidden</Badge>}
                  </div>
                  {item.description && <p className="hc-caption mt-1 text-sm">{item.description}</p>}
                  <div className="mt-3">
                    <ToggleForm item={item} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <PersonalShopItems items={personalItems} error={personalError} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <LinkTabs
            active={region}
            tabs={SHOP_REGIONS.map((r) => ({ key: r, href: `/shop?region=${r}${qParam}`, label: SHOP_REGION_LABELS[r] }))}
          />
          <form className="flex items-center gap-2">
            <input type="hidden" name="region" value={region} />
            <div className="relative w-64">
              <Icon
                glyph="search"
                size={20}
                className="hc-muted pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
              />
              <Input name="q" type="search" defaultValue={q ?? ""} placeholder="Search items..." className="hc-input-search" />
            </div>
            {q && (
              <ButtonLink href={`/shop?region=${region}`} variant="ghost" size="sm">
                Clear
              </ButtonLink>
            )}
          </form>
        </div>

        <Card>
          <CardHeader title={`Add an item to ${SHOP_REGION_LABELS[region]}`} icon="plus" />
          <AddShopItemForm action={addShopItem} region={region} />
          <div className="mt-5">
            <Details summary="Bulk upload from CSV">
              <BulkUploadShopItemsForm region={region} />
            </Details>
          </div>
        </Card>

        <h2 className="hc-heading flex items-center gap-2 text-base">
          {allItems.length} item{allItems.length === 1 ? "" : "s"} in {SHOP_REGION_LABELS[region]}
          {query && <Muted className="text-sm font-normal">matching &quot;{q}&quot;</Muted>}
        </h2>

        {allItems.length === 0 ? (
          <Card>
            <EmptyState title="Empty shelves" icon="bag">
              {query ? "Nothing matches that search." : "Add the first item above."}
            </EmptyState>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((item) => {
              const stock = stockByItem.get(item.id) ?? [];
              return (
                <Card key={item.id} className={item.active ? "" : "opacity-60"}>
                  <div className="flex gap-4">
                    <ItemThumb src={item.image_url} glyph="bag" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="hc-heading text-lg">{item.name}</span>
                        <Badge tone="success">{item.price} px</Badge>
                        <Badge outline>${(item.price * config.economy.pixelValueUsd).toFixed(2)} budget</Badge>
                        <Badge>{SHOP_CATEGORY_LABELS[item.category] ?? SHOP_CATEGORY_LABELS.other}</Badge>
                        {item.discount_percent > 0 && (
                          <Badge tone="warning">
                            {item.discount_percent}% off ({Math.round((item.price * (100 - item.discount_percent)) / 100)} px)
                          </Badge>
                        )}
                        {!item.active && <Badge>Hidden</Badge>}
                      </div>
                      {item.description && <p className="hc-caption mt-1 text-sm">{item.description}</p>}
                      {item.options.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {parseOptionGroups(item.options).map((g, gi) => (
                            <div key={gi} className="flex flex-wrap items-center gap-1.5">
                              {g.name && <Muted className="text-xs font-bold">{g.name}:</Muted>}
                              {g.choices.map((c) => (
                                <Badge key={c} outline>
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      {stock.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Muted className="text-xs font-bold">Stock:</Muted>
                          {stock.map((s) => (
                            <Badge key={s.choice} tone={s.remaining <= 0 ? "danger" : "neutral"}>
                              {s.choice} {s.remaining}/{s.total}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-2">
                        <ToggleForm item={item} />
                        <form action={deleteShopItem}>
                          <input type="hidden" name="id" value={item.id} />
                          <ActionButton
                            variant="danger"
                            size="sm"
                            icon="delete"
                            pendingLabel="Deleting..."
                            confirm={`Delete "${item.name}" from the shop? This can't be undone.`}
                          >
                            Delete
                          </ActionButton>
                        </form>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3">
                    <Details summary="Edit item">
                      <EditItemForm item={item} gateTrials={gateTrials} />
                    </Details>
                    <Details summary="Edit price in every region">
                      <form action={updateShopItemPrices} className="flex flex-col gap-3">
                        <input type="hidden" name="item_name" value={item.name} />
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {SHOP_REGIONS.map((r) => (
                            <Field key={r} label={SHOP_REGION_LABELS[r]}>
                              <div className="flex items-center gap-2">
                                <Input
                                  name={`price_${r}`}
                                  type="number"
                                  min={0}
                                  defaultValue={pricesByName.get(item.name)?.[r]?.price ?? 0}
                                  className="min-w-0 flex-1"
                                  aria-label={`${SHOP_REGION_LABELS[r]} price in pixels`}
                                />
                                <Input
                                  name={`discount_${r}`}
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  defaultValue={pricesByName.get(item.name)?.[r]?.discount ?? 0}
                                  className="w-20 shrink-0"
                                  aria-label={`${SHOP_REGION_LABELS[r]} sale percent off`}
                                  title="Sale % off"
                                />
                              </div>
                            </Field>
                          ))}
                        </div>
                        <Muted className="text-xs">
                          0 price means not for sale in that region. The first box is the price in px, the second is
                          that region&apos;s sale (% off, 0 = none). Name, description, options and image stay
                          per-region, edit those above.
                        </Muted>
                        <div>
                          <ActionButton pendingLabel="Saving...">Save prices</ActionButton>
                        </div>
                      </form>
                    </Details>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {allItems.length > PER && (
          <div className="flex flex-col gap-1">
            <Muted className="text-sm">
              Showing {start + 1}-{Math.min(start + PER, allItems.length)} of {allItems.length}
            </Muted>
            <Pagination page={cur} totalPages={pages} hrefFor={(p) => `/shop?region=${region}&page=${p}${qParam}`} />
          </div>
        )}
      </div>
    </div>
  );
}

function EditItemForm({
  item,
  gateTrials,
}: {
  item: ShopItemRow;
  gateTrials: { id: number; name: string; region: string | null }[];
}) {
  const unlockIds = (item.unlock_trial_ids ?? []).map(Number);
  return (
    <form action={updateShopItem} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="original_name" value={item.name} />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="Name">
          <Input name="name" required maxLength={60} defaultValue={item.name} />
        </Field>
        <Field label="Price (px)">
          <Input name="price" type="number" min={0} required defaultValue={item.price} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Region">
          <NativeSelect name="region" defaultValue={item.region}>
            {SHOP_REGIONS.map((r) => (
              <option key={r} value={r}>
                {SHOP_REGION_LABELS[r]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Category">
          <NativeSelect name="category" defaultValue={item.category}>
            {SHOP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {SHOP_CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Description">
        <Input name="description" maxLength={300} defaultValue={item.description} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="hc-label">Options</span>
        <OptionsEditor name="options" initial={item.options} />
      </div>
      <ShopItemEditConfigurator
        hasConfig={!!item.config_options}
        basePrice={item.config_options?.base_price ?? item.price}
        referenceUrl={item.config_options?.reference_url ?? ""}
        groups={(item.config_options?.groups ?? []).map((g) => ({
          name: g.name,
          type: g.type === "multi" ? ("multi" as const) : ("single" as const),
          choices: g.choices,
        }))}
        pixelValueUsd={config.economy.pixelValueUsd}
      />
      <div className="flex flex-col gap-1.5">
        <span className="hc-label">
          Unlock via Trial
          <span className="hc-label-hint">
            Locked until the player ships one of the ticked Trials. None ticked means anyone can buy it.
          </span>
        </span>
        <div className="hc-panel flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {gateTrials.length === 0 && <Muted className="text-sm">No active Trials.</Muted>}
          {gateTrials.map((t) => (
            <Checkbox
              key={t.id}
              name="unlock_trials"
              value={t.id}
              defaultChecked={unlockIds.includes(t.id)}
              label={
                <>
                  {t.name}
                  {t.region && <Muted> · {t.region}</Muted>}
                </>
              }
            />
          ))}
        </div>
      </div>
      <Field label="Replace image" hint="Optional. Leave empty to keep the current one.">
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp" className="hc-file" />
      </Field>
      <Checkbox
        name="apply_all_regions"
        value="1"
        label={
          <>
            Apply <strong>name, description &amp; category</strong> to this item in every region (price, options &amp;
            image stay per-region)
          </>
        }
      />
      <div className="hc-panel flex flex-col gap-3">
        <Checkbox
          name="manual_locked"
          value="1"
          defaultChecked={item.manual_locked}
          label={
            <>
              <strong>Locked</strong>: blocks purchase regardless of any Trial gate. Applies to this item in every
              region.
            </>
          }
        />
        <Field label="Unlock note" hint="Shown to players instead of the Trial prompt">
          <Input name="lock_note" maxLength={300} defaultValue={item.lock_note} placeholder="e.g. back in stock next chapter" />
        </Field>
      </div>
      <div className="hc-panel">
        <Checkbox
          name="beacon_locked"
          value="1"
          defaultChecked={item.beacon_locked}
          label={
            <>
              <strong>Beacon-locked</strong>: only buyable by players who have a Beacon project (see the project
              page&apos;s Beacon nomination) they haven&apos;t already spent on another Beacon-locked item. One Beacon
              unlocks exactly one Beacon-locked item. Applies to this item in every region.
            </>
          }
        />
      </div>
      <Field
        label="Sale %"
        hint="0 = none. This region only, off the base price and every config add-on. Set every region's sale at once under 'Edit price in every region' below."
      >
        <Input
          name="discount_percent"
          type="number"
          min="0"
          max="100"
          step="1"
          defaultValue={item.discount_percent || 0}
          className="w-24"
        />
      </Field>
      <Checkbox name="silent" value="1" label="Save silently (don't notify Pixo/Slack about this change)" />
      <div>
        <ActionButton pendingLabel="Saving...">Save changes</ActionButton>
      </div>
    </form>
  );
}
