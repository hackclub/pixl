import { requirePagePerm } from "@/lib/guard";
import { listShopItems, SHOP_REGIONS, SHOP_REGION_LABELS, SHOP_CATEGORY_LABELS, type ShopItemRow } from "@/lib/db";
import { updateShopItemRegionDetails } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { PriceUsdInput } from "@/app/_components/PriceUsdInput";
import { parseOptionGroups } from "@/lib/shopOptions";
import { config } from "@/app/_generated/config";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

// One page, every region's price + price source side by side, per item - built
// so an admin auditing regional pricing (Europe was the trigger) doesn't have
// to hop between /shop's per-region tabs to see what's off. See
// updateShopItemRegionDetails in app/actions.ts for the save side.
export default async function ShopDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePagePerm(["shop"]);
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Shop Detail</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Every shop item, one at a time, with every region&apos;s price and where that price came
          from - for auditing pricing (Europe and otherwise) against the real listing.
        </p>
      </div>

      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search item names…"
          className="w-full min-w-0 max-w-72 text-sm"
        />
      </form>

      <div className="text-sm text-muted-foreground">
        {names.length} item{names.length === 1 ? "" : "s"}
      </div>

      <div className="grid gap-4">
        {names.map((name) => {
          const rows = byName.get(name)!;
          const byRegion = new Map(rows.map((r) => [r.region, r]));
          const anyRow = rows[0];
          const options = parseOptionGroups(anyRow.options);
          return (
            <Card key={name} className="p-4 md:p-5 gap-4 flex-row">
              {anyRow.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={anyRow.image_url}
                  alt=""
                  className="w-20 h-20 rounded-lg object-cover border border-border shrink-0 [image-rendering:pixelated]"
                />
              ) : (
                <span className="grid place-items-center w-20 h-20 rounded-lg bg-muted border border-border shrink-0 text-2xl">
                  🛍️
                </span>
              )}
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{name}</span>
                  <Badge variant="secondary">
                    {SHOP_CATEGORY_LABELS[anyRow.category] ?? SHOP_CATEGORY_LABELS.other}
                  </Badge>
                  {!rows.some((r) => r.active) && <Badge variant="secondary">hidden everywhere</Badge>}
                </div>

                {options.length > 0 && (
                  <div className="space-y-1">
                    {options.map((g, gi) => (
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

                <form action={updateShopItemRegionDetails} className="space-y-3">
                  <input type="hidden" name="item_name" value={name} />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-separate border-spacing-y-2">
                      <thead>
                        <tr className="text-xs text-muted-foreground text-left">
                          <th className="font-medium pr-2">Region</th>
                          <th className="font-medium pr-2">Price (px)</th>
                          <th className="font-medium pr-2">≈ USD</th>
                          <th className="font-medium">Price source link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SHOP_REGIONS.map((r) => {
                          const row = byRegion.get(r);
                          return (
                            <tr key={r}>
                              <td className="pr-2 align-top pt-1.5 whitespace-nowrap">
                                {SHOP_REGION_LABELS[r]}
                                {!row && (
                                  <div className="text-[11px] text-muted-foreground">not stocked</div>
                                )}
                              </td>
                              <td className="pr-2 align-top">
                                <PriceUsdInput
                                  name={`price_${r}`}
                                  defaultValue={row?.price ?? 0}
                                  disabled={!row}
                                  pixelValueUsd={config.economy.pixelValueUsd}
                                />
                              </td>
                              <td className="pr-2 align-top pt-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
                                ${((row?.price ?? 0) * config.economy.pixelValueUsd).toFixed(2)}
                              </td>
                              <td className="align-top">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    name={`source_${r}`}
                                    type="url"
                                    disabled={!row}
                                    placeholder="https://…"
                                    defaultValue={row?.price_source_url ?? ""}
                                    className="w-full min-w-[12rem] text-sm"
                                  />
                                  {row?.price_source_url && (
                                    <a
                                      href={row.price_source_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-brand hover:underline shrink-0"
                                    >
                                      Open
                                    </a>
                                  )}
                                </div>
                                {row?.config_options && (
                                  <div className="mt-2 rounded-md border border-border p-2 space-y-2 bg-muted/30">
                                    <div className="text-[11px] font-medium text-muted-foreground">
                                      Configurator base price + reference (groups/choice pricing
                                      still need a migration to change)
                                    </div>
                                    <div className="flex gap-2 items-center flex-wrap">
                                      <Label className="flex items-center gap-1.5 font-normal text-xs text-muted-foreground">
                                        Base price
                                        <Input
                                          name={`config_base_price_${r}`}
                                          type="number"
                                          min={0}
                                          defaultValue={row.config_options.base_price ?? 0}
                                          className="w-24 text-sm"
                                        />
                                      </Label>
                                    </div>
                                    <Input
                                      name={`config_reference_url_${r}`}
                                      type="url"
                                      placeholder="https://…"
                                      defaultValue={row.config_options.reference_url ?? ""}
                                      className="w-full text-sm"
                                    />
                                    {(row.config_options.groups ?? []).map((g, gi) => (
                                      <div key={gi} className="text-xs">
                                        <span className="font-medium text-muted-foreground">
                                          {g.name}:
                                        </span>{" "}
                                        {g.choices.map((c, ci) => (
                                          <span key={ci} className="text-muted-foreground">
                                            {c.label} (+{c.price}px)
                                            {ci < g.choices.length - 1 ? ", " : ""}
                                          </span>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      name="silent"
                      value="1"
                      className="mt-0.5 h-4 w-4 rounded border-border accent-brand"
                    />
                    <span>Save silently , don&apos;t notify Pixo/Slack about this change</span>
                  </label>
                  <PendingButton
                    className="bg-brand text-white border-transparent"
                    pendingText="Saving…"
                  >
                    Save all regions
                  </PendingButton>
                </form>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
