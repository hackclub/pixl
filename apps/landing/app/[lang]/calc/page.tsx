"use client";

import { useState } from "react";
import { config, projectPayoutPx } from "../../_generated/config";

const TIERS = [
  { value: 1, label: "T1 · Spark", blurb: "A simple site, script, or tiny tool" },
  { value: 2, label: "T2 · Signal", blurb: "A focused app, CLI, or game with clean polish" },
  { value: 3, label: "T3 · Grid", blurb: "Multiple systems together: backend, state, infra" },
  { value: 4, label: "T4 · Nexus", blurb: "Deep systems work, serious scope" },
];

export default function CalcPage() {
  const [hoursInput, setHoursInput] = useState("10");
  const [tier, setTier] = useState(1);

  const hours = Math.max(Number(hoursInput) || 0, 0);
  const px = Math.round(projectPayoutPx(hours, tier, 0));
  const usd = px * config.economy.pixelValueUsd;

  return (
    <div className="bg-[#F5EED2] min-h-screen text-black font-pixel flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-[#fffaf7] border-2 border-black px-6 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl">Pixel Calculator</h1>
          <p className="text-sm font-sans text-black/70 mt-1">
            Estimate what a project earns before you ship it.
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm">Hours</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={hoursInput}
            onChange={(e) => setHoursInput(e.target.value)}
            className="border-2 border-black px-3 py-2 font-sans bg-white"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(Number(e.target.value))}
            className="border-2 border-black px-3 py-2 font-sans bg-white"
          >
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="text-xs font-sans text-black/60">
            {TIERS[tier - 1].blurb}
          </span>
        </label>

        <div className="border-2 border-black bg-black text-[#F5EED2] px-4 py-4 flex flex-col items-center gap-1">
          <span className="text-xs font-sans uppercase tracking-wide opacity-70">
            Estimated payout
          </span>
          <span className="text-3xl">{px.toLocaleString()} px</span>
          <span className="text-sm font-sans opacity-80">${usd.toFixed(2)}</span>
        </div>

        <p className="text-xs font-sans text-black/50 leading-relaxed">
          Rough estimate only - actual pixels depend on the tier a reviewer assigns and
          how many hours they credit. Rate climbs as this project&apos;s own Restoration
          Energy grows, from ${config.economy.basePayoutUsd.toFixed(2)}/hr toward $
          {config.economy.maxPayoutUsd.toFixed(2)}/hr.
        </p>
      </div>
    </div>
  );
}
