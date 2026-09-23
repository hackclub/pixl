"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface EditableChoice {
  label: string;
  price: number;
  // Only set (and only shown) when creating an item across multiple regions
  // at once - a region with no entry here just uses `price` above, same
  // fallback rule as the item's own top-level price/region override.
  regionPrices?: Partial<Record<string, number>>;
}

export interface EditableGroup {
  name: string;
  type: "single" | "multi";
  choices: EditableChoice[];
}

// A choice's price surcharge, editable in px or USD - mirrors PriceUsdInput's
// conversion (px = usd / pixelValueUsd) but keeps the value in local state
// instead of a named form field, since choices live in a dynamic list that
// serializes as one JSON blob on submit (see the hidden input below).
function ChoicePriceInput({
  price,
  onChange,
  pixelValueUsd,
}: {
  price: number;
  onChange: (px: number) => void;
  pixelValueUsd: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={0}
        value={price}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        className="w-20 text-sm"
      />
      <span className="text-[11px] text-muted-foreground shrink-0">px</span>
      <span className="text-muted-foreground text-xs">or</span>
      <div className="flex items-center gap-0.5">
        <span className="text-[11px] text-muted-foreground">$</span>
        <Input
          type="number"
          min={0}
          step="0.01"
          placeholder="USD"
          defaultValue={price > 0 ? (price * pixelValueUsd).toFixed(2) : ""}
          onChange={(e) => {
            const usd = Number(e.target.value) || 0;
            onChange(Math.max(0, Math.round(usd / pixelValueUsd)));
          }}
          className="w-20 text-sm"
        />
      </div>
    </div>
  );
}

// Price-changing options (config_options.groups) for one region's row - a
// group is e.g. "Version" with choices like "8GB/128GB" (+0px) and "8GB/256GB
// PaperMatte" (+2272px). Distinct from the plain `options` column (Color:
// Red, Blue, ...), which is just descriptive text with no price effect - see
// lib/shopOptions.ts. buy_shop_item charges by exact label match, so
// relabeling a choice here doesn't affect past orders (each one snapshots its
// own picked config), only future purchases.
export function ShopConfigEditor({
  name,
  initialGroups,
  pixelValueUsd,
  regions,
  regionLabels,
  onApplyToAllRegions,
  injectedGroup,
}: {
  name: string;
  initialGroups: EditableGroup[];
  pixelValueUsd: number;
  // When creating an item across several regions at once, show a per-region
  // override row under each choice (same idea as the item's own price
  // field). Omit for the single-region shop-detail editor.
  regions?: string[];
  regionLabels?: Partial<Record<string, string>>;
  // Shop-detail's per-region editors are otherwise fully independent React
  // state with no shared parent that knows about groups specifically - this
  // callback is how a group reaches ShopItemConfigurators, which then hands
  // it back down to every OTHER region's editor as injectedGroup below.
  onApplyToAllRegions?: (group: EditableGroup) => void;
  // A group pushed in from another region's "Apply to all regions" click.
  // `token` changes on every push (even re-applying an unchanged group), so
  // the effect below fires each time rather than only on first receipt.
  injectedGroup?: { group: EditableGroup; token: number };
}) {
  const [groups, setGroups] = useState<EditableGroup[]>(initialGroups);

  // Merge an incoming group: replace an existing same-named group (case-
  // insensitive) so re-applying is idempotent instead of duplicating it,
  // otherwise append.
  useEffect(() => {
    if (!injectedGroup) return;
    setGroups((prev) => {
      const incoming = injectedGroup.group;
      const idx = prev.findIndex(
        (g) => g.name.trim().toLowerCase() === incoming.name.trim().toLowerCase(),
      );
      if (idx === -1) return [...prev, incoming];
      const next = [...prev];
      next[idx] = incoming;
      return next;
    });
    // Only the token identifies a new push - re-running this because `groups`
    // or `injectedGroup.group` changed identity on every render would fight
    // the local edits this same effect just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedGroup?.token]);

  function addGroup() {
    setGroups([...groups, { name: "", type: "single", choices: [{ label: "", price: 0 }] }]);
  }

  function removeGroup(gi: number) {
    setGroups(groups.filter((_, i) => i !== gi));
  }

  function updateGroup(gi: number, patch: Partial<EditableGroup>) {
    setGroups(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  }

  function addChoice(gi: number) {
    updateGroup(gi, { choices: [...groups[gi].choices, { label: "", price: 0 }] });
  }

  function removeChoice(gi: number, ci: number) {
    updateGroup(gi, { choices: groups[gi].choices.filter((_, i) => i !== ci) });
  }

  function updateChoice(gi: number, ci: number, patch: Partial<EditableChoice>) {
    updateGroup(gi, {
      choices: groups[gi].choices.map((c, i) => (i === ci ? { ...c, ...patch } : c)),
    });
  }

  return (
    <div className="space-y-2">
      {groups.map((g, gi) => (
        <div key={gi} className="rounded-md border border-border p-2 space-y-1.5 bg-background">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Input
              placeholder="Group name (e.g. Version)"
              value={g.name}
              onChange={(e) => updateGroup(gi, { name: e.target.value })}
              className="w-40 text-xs"
            />
            <select
              value={g.type}
              onChange={(e) => updateGroup(gi, { type: e.target.value as "single" | "multi" })}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            >
              <option value="single">Pick one</option>
              <option value="multi">Pick any (add-ons)</option>
            </select>
            {onApplyToAllRegions && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                title="Copy this group (name, type, choices, prices) into every other region's configurator, replacing a same-named group there if one exists"
                onClick={() => onApplyToAllRegions(g)}
              >
                Apply to all regions
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`text-destructive hover:text-destructive ${onApplyToAllRegions ? "" : "ml-auto"}`}
              onClick={() => removeGroup(gi)}
            >
              Remove group
            </Button>
          </div>
          {g.choices.map((c, ci) => (
            <div key={ci} className="pl-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Input
                  placeholder="Choice label"
                  value={c.label}
                  onChange={(e) => updateChoice(gi, ci, { label: e.target.value })}
                  className="w-48 text-xs"
                />
                <ChoicePriceInput
                  price={c.price}
                  onChange={(px) => updateChoice(gi, ci, { price: px })}
                  pixelValueUsd={pixelValueUsd}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeChoice(gi, ci)}
                >
                  ✕
                </Button>
              </div>
              {regions && regions.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1 mt-1">
                  {regions.map((r) => (
                    <label key={r} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {regionLabels?.[r] ?? r}
                      <Input
                        type="number"
                        min={0}
                        placeholder={String(c.price)}
                        value={c.regionPrices?.[r] ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = { ...(c.regionPrices ?? {}) };
                          if (raw === "") delete next[r];
                          else next[r] = Math.max(0, Math.round(Number(raw) || 0));
                          updateChoice(gi, ci, { regionPrices: next });
                        }}
                        className="w-16 h-6 text-[11px] px-1.5"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => addChoice(gi)}>
            + Add choice
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addGroup}>
        + Add option group
      </Button>
      {/* Blank labels/all-zero-only groups are dropped server-side, so an
         empty in-progress group left on the page is harmless either way. */}
      <input type="hidden" name={name} value={JSON.stringify(groups)} />
    </div>
  );
}
