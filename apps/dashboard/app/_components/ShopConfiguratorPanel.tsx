"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PriceUsdInput } from "@/app/_components/PriceUsdInput";
import { ShopConfigEditor, type EditableGroup } from "@/app/_components/ShopConfigEditor";

// Whether a region's row has price-changing options at all (config_options)
// is itself something an admin should be able to turn on/off, not just edit
// once it exists - toggling the checkbox reveals the same editor either way,
// with fresh (empty) defaults for an item that never had one.
export function ShopConfiguratorPanel({
  region,
  hasConfig,
  basePrice,
  referenceUrl,
  groups,
  pixelValueUsd,
  onApplyGroupToAllRegions,
  injectedGroup,
  labelText,
}: {
  // Empty string for a single-region caller (e.g. the plain /shop edit
  // form, which edits one item row at a time, not per-region) - field names
  // drop the trailing "_" suffix rather than submitting "config_enable_"
  // with nothing after it.
  region: string;
  hasConfig: boolean;
  basePrice: number;
  referenceUrl: string;
  groups: EditableGroup[];
  pixelValueUsd: number;
  onApplyGroupToAllRegions?: (group: EditableGroup) => void;
  injectedGroup?: { group: EditableGroup; token: number };
  labelText?: string;
}) {
  const [enabled, setEnabled] = useState(hasConfig);
  const field = (base: string) => (region ? `${base}_${region}` : base);

  // A group applied from another region needs somewhere to land even if this
  // region never had a configurator turned on before.
  useEffect(() => {
    if (injectedGroup) setEnabled(true);
  }, [injectedGroup]);

  return (
    <div className="mt-2 rounded-md border border-border p-2 space-y-2 bg-muted/30">
      <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => setEnabled(v === true)}
        />
        {labelText ?? "This region has price-changing options (configurator)"}
      </Label>
      {enabled ? (
        <div className="space-y-2">
          <input type="hidden" name={field("config_enable")} value="1" />
          <div className="flex gap-2 items-center flex-wrap">
            <Label className="flex items-center gap-1.5 font-normal text-xs text-muted-foreground">
              Base price
              <PriceUsdInput
                name={field("config_base_price")}
                defaultValue={basePrice}
                pixelValueUsd={pixelValueUsd}
              />
            </Label>
          </div>
          <Input
            name={field("config_reference_url")}
            type="url"
            placeholder="https://… (reference listing for the base price)"
            defaultValue={referenceUrl}
            className="w-full text-sm"
          />
          <ShopConfigEditor
            name={field("config_groups")}
            initialGroups={groups}
            pixelValueUsd={pixelValueUsd}
            onApplyToAllRegions={onApplyGroupToAllRegions}
            injectedGroup={injectedGroup}
          />
        </div>
      ) : (
        hasConfig && <input type="hidden" name={field("config_disable")} value="1" />
      )}
    </div>
  );
}
