"use client";

import { useState } from "react";
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
}: {
  region: string;
  hasConfig: boolean;
  basePrice: number;
  referenceUrl: string;
  groups: EditableGroup[];
  pixelValueUsd: number;
}) {
  const [enabled, setEnabled] = useState(hasConfig);

  return (
    <div className="mt-2 rounded-md border border-border p-2 space-y-2 bg-muted/30">
      <Label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => setEnabled(v === true)}
        />
        This region has price-changing options (configurator)
      </Label>
      {enabled ? (
        <div className="space-y-2">
          <input type="hidden" name={`config_enable_${region}`} value="1" />
          <div className="flex gap-2 items-center flex-wrap">
            <Label className="flex items-center gap-1.5 font-normal text-xs text-muted-foreground">
              Base price
              <PriceUsdInput
                name={`config_base_price_${region}`}
                defaultValue={basePrice}
                pixelValueUsd={pixelValueUsd}
              />
            </Label>
          </div>
          <Input
            name={`config_reference_url_${region}`}
            type="url"
            placeholder="https://… (reference listing for the base price)"
            defaultValue={referenceUrl}
            className="w-full text-sm"
          />
          <ShopConfigEditor
            name={`config_groups_${region}`}
            initialGroups={groups}
            pixelValueUsd={pixelValueUsd}
          />
        </div>
      ) : (
        hasConfig && <input type="hidden" name={`config_disable_${region}`} value="1" />
      )}
    </div>
  );
}
