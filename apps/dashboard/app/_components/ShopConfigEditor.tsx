"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface EditableChoice {
  label: string;
  price: number;
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
}: {
  name: string;
  initialGroups: EditableGroup[];
  pixelValueUsd: number;
}) {
  const [groups, setGroups] = useState<EditableGroup[]>(initialGroups);

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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive ml-auto"
              onClick={() => removeGroup(gi)}
            >
              Remove group
            </Button>
          </div>
          {g.choices.map((c, ci) => (
            <div key={ci} className="flex items-center gap-1.5 flex-wrap pl-2">
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
