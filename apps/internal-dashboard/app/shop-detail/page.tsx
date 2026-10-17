/* eslint-disable @next/next/no-img-element */
import { requirePage } from "@/lib/guard";
import { listShopItems, SHOP_REGIONS, SHOP_REGION_LABELS, SHOP_CATEGORY_LABELS, type ShopItemRow } from "@/lib/db";
import { updateShopItemRegionDetails } from "@/app/actions";
import { ShopItemConfigurators } from "@/app/_components/ShopItemConfigurators";
import { parseOptionGroups } from "@/lib/shopOptions";
import { config } from "@/app/_generated/config";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  FilterBar,
  Icon,
  Muted,
  PageHeader,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

// One page, every region's price and price source side by side, per item, so
// an admin auditing regional pricing (Europe was the trigger) doesn't have to
// hop between /shop's per-region tabs to see what's off. See
// updateShopItemRegionDetails in app/actions.ts for the save side.
export default async function ShopDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePage("owner");
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const everyItem = await listShopItems();
  const byName = new Map<string, ShopItemRow[]>();
  for (const it of everyItem) {
    if (it.unlock_xp > 0) continue; // trophies aren't region-scoped or priced
    if (it.category === "grants") continue; // grants are the same price everywhere, nothing to audit
    const list = byName.get(it.name) ?? [];
    list.push(it);
    byName.set(it.name, list);
  }
  let names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  if (query) names = names.filter((n) => n.toLowerCase().includes(query));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Regional pricing"
        count={names.length}
        description="Every shop item with each region's price and where that price came from, for auditing pricing against the real listing."
        actions={
          <ButtonLink href="/shop" variant="outline" size="sm" icon="view-back">
            Shop
          </ButtonLink>
        }
      />

      <FilterBar q={q} placeholder="Search item names..." />

      {names.length === 0 && (
        <Card>
          <EmptyState title="No items" icon="bag">
            {query ? "Nothing matches that search." : "There are no region-priced items yet."}
          </EmptyState>
        </Card>
      )}

      {names.map((name) => {
        const rows = byName.get(name)!;
        const byRegion = new Map(rows.map((r) => [r.region, r]));
        const anyRow = rows[0];
        const options = parseOptionGroups(anyRow.options);
        return (
          <Card key={name}>
            <div className="flex gap-4">
              {anyRow.image_url ? (
                <img
                  src={anyRow.image_url}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md border border-[var(--border)] object-cover [image-rendering:pixelated]"
                />
              ) : (
                <span className="hc-muted grid h-16 w-16 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--sunken)]">
                  <Icon glyph="bag" size={28} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="hc-heading text-lg">{name}</span>
                  <Badge>{SHOP_CATEGORY_LABELS[anyRow.category] ?? SHOP_CATEGORY_LABELS.other}</Badge>
                  {!rows.some((r) => r.active) && <Badge tone="warning">Hidden everywhere</Badge>}
                </div>
                {options.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {options.map((g, gi) => (
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
              </div>
            </div>

            <form action={updateShopItemRegionDetails} className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="item_name" value={name} />
              <div className="hc-table-wrap rounded-[var(--radius-lg)] border border-[var(--border)]">
                <table className="hc-table">
                  <thead>
                    <tr>
                      <th>Region</th>
                      <th>Price</th>
                      <th>USD</th>
                      <th>Price source link / alternate</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ShopItemConfigurators
                      pixelValueUsd={config.economy.pixelValueUsd}
                      regions={SHOP_REGIONS.map((r) => {
                        const row = byRegion.get(r);
                        return {
                          region: r,
                          label: SHOP_REGION_LABELS[r],
                          hasRow: !!row,
                          price: row?.price ?? 0,
                          priceSourceUrl: row?.price_source_url ?? "",
                          altSourceUrl: row?.alt_source_url ?? "",
                          hasConfig: !!row?.config_options,
                          basePrice: row?.config_options?.base_price ?? row?.price ?? 0,
                          referenceUrl: row?.config_options?.reference_url ?? "",
                          groups: (row?.config_options?.groups ?? []).map((g) => ({
                            name: g.name,
                            type: g.type === "multi" ? ("multi" as const) : ("single" as const),
                            choices: g.choices,
                          })),
                        };
                      })}
                    />
                  </tbody>
                </table>
              </div>
              <Checkbox name="silent" value="1" label="Save silently (don't notify Pixo/Slack about this change)" />
              <div>
                <ActionButton pendingLabel="Saving...">Save all regions</ActionButton>
              </div>
            </form>
          </Card>
        );
      })}
    </div>
  );
}
