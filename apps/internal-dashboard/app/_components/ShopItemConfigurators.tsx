"use client";

import { useState } from "react";
import { PriceUsdInput } from "@/app/_components/PriceUsdInput";
import { ShopConfiguratorPanel } from "@/app/_components/ShopConfiguratorPanel";
import type { EditableGroup } from "@/app/_components/ShopConfigEditor";
import { Input, Muted, TextLink } from "@/app/_ui/ui";
import { isSafeUrl } from "@/lib/safeUrl";

export interface ShopDetailRegionData {
  region: string;
  label: string;
  hasRow: boolean;
  price: number;
  priceSourceUrl: string;
  altSourceUrl: string;
  hasConfig: boolean;
  basePrice: number;
  referenceUrl: string;
  groups: EditableGroup[];
}

// The whole per-item regional-pricing table body, as one client component, so
// "Apply to all regions" on a configurator group has a shared parent to
// coordinate through. Each region's ShopConfiguratorPanel is otherwise fully
// independent React state with nothing connecting them.
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
        <tr key={r.region} className="align-top">
          <td className="whitespace-nowrap">
            <span className="font-bold">{r.label}</span>
            {!r.hasRow && <Muted className="block text-xs">Not stocked</Muted>}
          </td>
          <td>
            <PriceUsdInput
              name={`price_${r.region}`}
              defaultValue={r.price}
              disabled={!r.hasRow}
              pixelValueUsd={pixelValueUsd}
            />
          </td>
          <td className="hc-muted whitespace-nowrap tabular-nums">${(r.price * pixelValueUsd).toFixed(2)}</td>
          <td className="min-w-72">
            <div className="flex items-center gap-2">
              <Input
                name={`source_${r.region}`}
                type="url"
                disabled={!r.hasRow}
                placeholder="https://..."
                defaultValue={r.priceSourceUrl}
              />
              {r.priceSourceUrl && (
                <TextLink href={r.priceSourceUrl} external className="shrink-0 text-sm">
                  Open
                </TextLink>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Input
                name={`alt_source_${r.region}`}
                type="url"
                disabled={!r.hasRow}
                placeholder="Alternate link https://..."
                defaultValue={r.altSourceUrl}
              />
              {r.altSourceUrl && isSafeUrl(r.altSourceUrl) && (
                <TextLink href={r.altSourceUrl} external className="shrink-0 text-sm">
                  Open
                </TextLink>
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
