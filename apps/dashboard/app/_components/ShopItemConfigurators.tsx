"use client";

import { useState } from "react";
import { PriceUsdInput } from "@/app/_components/PriceUsdInput";
import { ShopConfiguratorPanel } from "@/app/_components/ShopConfiguratorPanel";
import type { EditableGroup } from "@/app/_components/ShopConfigEditor";
import { Input } from "@/components/ui/input";

export interface ShopDetailRegionData {
  region: string;
  label: string;
  hasRow: boolean;
  price: number;
  priceSourceUrl: string;
  hasConfig: boolean;
  basePrice: number;
  referenceUrl: string;
  groups: EditableGroup[];
}

// The whole per-item regional-pricing table body, as one client component -
// pulled out of shop-detail/page.tsx specifically so "Apply to all regions"
// on a configurator group has a shared parent to coordinate through. Each
// region's ShopConfiguratorPanel is otherwise fully independent React state
// with nothing connecting them.
export function ShopItemConfigurators({
  regions,
  pixelValueUsd,
}: {
  regions: ShopDetailRegionData[];
  pixelValueUsd: number;
}) {
  const [pending, setPending] = useState<Record<string, { group: EditableGroup; token: number } | undefined>>({});
  const [tokenSeq, setTokenSeq] = useState(0);

  function applyToAllRegions(sourceRegion: string, group: EditableGroup) {
    const token = tokenSeq + 1;
    setTokenSeq(token);
    setPending((prev) => {
      const next = { ...prev };
      for (const r of regions) {
        if (r.region === sourceRegion || !r.hasRow) continue;
        next[r.region] = { group, token };
      }
      return next;
    });
  }

  return (
    <>
      {regions.map((r) => (
        <tr key={r.region}>
          <td className="pr-2 align-top pt-1.5 whitespace-nowrap">
            {r.label}
            {!r.hasRow && <div className="text-[11px] text-muted-foreground">not stocked</div>}
          </td>
          <td className="pr-2 align-top">
            <PriceUsdInput
              name={`price_${r.region}`}
              defaultValue={r.price}
              disabled={!r.hasRow}
              pixelValueUsd={pixelValueUsd}
            />
          </td>
          <td className="pr-2 align-top pt-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
            ${(r.price * pixelValueUsd).toFixed(2)}
          </td>
          <td className="align-top">
            <div className="flex items-center gap-1.5">
              <Input
                name={`source_${r.region}`}
                type="url"
                disabled={!r.hasRow}
                placeholder="https://…"
                defaultValue={r.priceSourceUrl}
                className="w-full min-w-[12rem] text-sm"
              />
              {r.priceSourceUrl && (
                <a
                  href={r.priceSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand hover:underline shrink-0"
                >
                  Open
                </a>
              )}
            </div>
            {r.hasRow && (
              <ShopConfiguratorPanel
                region={r.region}
                hasConfig={r.hasConfig}
                basePrice={r.basePrice}
                referenceUrl={r.referenceUrl}
                groups={r.groups}
                pixelValueUsd={pixelValueUsd}
                onApplyGroupToAllRegions={(group) => applyToAllRegions(r.region, group)}
                injectedGroup={pending[r.region]}
              />
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
