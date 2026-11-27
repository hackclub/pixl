"use client";

import { useState } from "react";
import { adjustPixels } from "@/app/actions";
import { config } from "@/app/_generated/config";
import { ActionButton, Details, Field, Input, Textarea } from "@/app/_ui/ui";
import { PlayerPicker } from "./PlayerPicker";

// Matches the rate everywhere else pixels get converted to dollars (see
// actions.ts, lib/db.ts).
const PX_PER_DOLLAR = 1 / config.economy.pixelValueUsd;

// Owner-only manual pixel correction: pick a player, deduct or grant whole
// pixels with a mandatory reason. Everything lands in the ledger. On a
// player's own page the player is fixed, so the search box is hidden.
export function PixelAdjustForm({
  player,
  back,
}: {
  player?: { id: string; name: string };
  back?: string;
}) {
  const [mode, setMode] = useState<"deduct" | "grant">("deduct");
  const [amount, setAmount] = useState("");
  const [dollars, setDollars] = useState("");

  return (
    <Details summary={player ? "Add or deduct pixels" : "Adjust a player's pixels (owners only)"}>
      <form action={adjustPixels} className="flex flex-col gap-4">
        {player && <input type="hidden" name="userId" value={player.id} />}
        {back && <input type="hidden" name="back" value={back} />}
        <div
          className={
            player
              ? "grid items-end gap-3 sm:grid-cols-[auto_auto]"
              : "grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          }
        >
          {!player && <PlayerPicker />}

          <div className="hc-segmented" role="tablist" aria-label="Direction">
            <input type="hidden" name="mode" value={mode} />
            {(["deduct", "grant"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className="hc-segmented-item px-3"
                onClick={() => setMode(m)}
              >
                {m === "deduct" ? "Deduct" : "Grant"}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              name="amount"
              type="number"
              min="1"
              step="1"
              required
              placeholder="Pixels"
              aria-label="Pixels"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setDollars("");
              }}
              className="w-24"
            />
            <span className="hc-muted text-xs">=</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="$"
              title="Convert dollars to pixels"
              aria-label="Dollars"
              value={dollars}
              onChange={(e) => {
                const v = e.target.value;
                setDollars(v);
                const n = Number(v);
                setAmount(v && Number.isFinite(n) && n >= 0 ? String(Math.round(n * PX_PER_DOLLAR)) : "");
              }}
              className="w-20"
            />
          </div>
        </div>

        <Field label="Reason" hint="Required. Names the transaction in the log and is shown to the player.">
          <Textarea name="reason" required rows={2} placeholder="e.g. Logo design, contract work" />
        </Field>

        <div>
          <ActionButton
            variant={mode === "deduct" ? "danger" : "success"}
            pendingLabel={mode === "deduct" ? "Deducting..." : "Granting..."}
          >
            {mode === "deduct" ? "Deduct pixels" : "Grant pixels"}
          </ActionButton>
        </div>
      </form>
    </Details>
  );
}
