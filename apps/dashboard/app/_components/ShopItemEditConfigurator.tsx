"use client";

import { useState } from "react";
import { ShopConfiguratorPanel } from "@/app/_components/ShopConfiguratorPanel";
import type { EditableGroup } from "@/app/_components/ShopConfigEditor";

// The plain /shop "Edit item" form edits one region's row at a time - unlike
// /shop-detail (see ShopItemConfigurators.tsx), there's no sibling region
// editor on the same page to broadcast a group into live. Instead, "Apply to
// all regions" here just stages the group's name into a hidden field
// (apply_groups_all_regions), and updateShopItem does the actual
// cross-region write once the form is submitted - one atomic save rather
// than a separate network call per click.
export function ShopItemEditConfigurator({
  hasConfig,
  basePrice,
  referenceUrl,
  groups,
  pixelValueUsd,
}: {
  hasConfig: boolean;
  basePrice: number;
  referenceUrl: string;
  groups: EditableGroup[];
  pixelValueUsd: number;
}) {
  const [staged, setStaged] = useState<string[]>([]);

  function stage(group: EditableGroup) {
    const name = group.name.trim();
    if (!name) return;
    setStaged((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  return (
    <>
      <ShopConfiguratorPanel
        region=""
        hasConfig={hasConfig}
        basePrice={basePrice}
        referenceUrl={referenceUrl}
        groups={groups}
        pixelValueUsd={pixelValueUsd}
        onApplyGroupToAllRegions={stage}
        labelText="This item has price-changing options (configurator)"
      />
      <input type="hidden" name="apply_groups_all_regions" value={staged.join("|")} />
      {staged.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Will push &quot;{staged.join('", "')}&quot; to every other region&apos;s copy of this item on save.
        </p>
      )}
    </>
  );
}
