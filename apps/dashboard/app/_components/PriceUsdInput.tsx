"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

// Lets an admin type a USD price and have it convert to pixels automatically
// (px = usd / pixelValueUsd), instead of doing that math by hand against the
// retailer's listed price. The px field stays the one actually submitted
// (name={name}) - the USD field is just a client-side helper that writes into
// it, so nothing on the server/action side needs to change.
export function PriceUsdInput({
  name,
  defaultValue,
  disabled,
  pixelValueUsd,
}: {
  name: string;
  defaultValue: number;
  disabled?: boolean;
  pixelValueUsd: number;
}) {
  const [px, setPx] = useState(defaultValue);

  return (
    <div className="flex items-center gap-1">
      <Input
        name={name}
        type="number"
        min={0}
        disabled={disabled}
        value={px}
        onChange={(e) => setPx(Math.max(0, Math.round(Number(e.target.value) || 0)))}
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
          disabled={disabled}
          placeholder="USD"
          onChange={(e) => {
            const usd = Number(e.target.value) || 0;
            setPx(Math.max(0, Math.round(usd / pixelValueUsd)));
          }}
          className="w-20 text-sm"
        />
      </div>
    </div>
  );
}
