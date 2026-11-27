"use client";

import { useState } from "react";
import { transferPlayerPixels, type PlayerHit } from "@/app/actions";
import { config } from "@/app/_generated/config";
import { ActionButton, Details, Field, Input, Textarea } from "@/app/_ui/ui";
import { PlayerPicker } from "./PlayerPicker";

const PX_PER_DOLLAR = 1 / config.economy.pixelValueUsd;

// Owner-only player-to-player transfer. The current player can send pixels to
// another player, or receive pixels from them; either way the other side is
// picked with the same typeahead as the rest of the dashboard.
export function PixelTransferForm({
  player,
  balance,
  back,
}: {
  player: { id: string; name: string };
  balance: number;
  back: string;
}) {
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [other, setOther] = useState<PlayerHit | null>(null);
  const [amount, setAmount] = useState("");
  const [dollars, setDollars] = useState("");

  const numeric = Number(amount);
  const validAmount = Number.isFinite(numeric) && numeric > 0;
  const overBalance = direction === "out" && validAmount && numeric > balance;
  const otherName = other?.name ?? "the other player";
  const fromName = direction === "out" ? player.name : otherName;
  const toName = direction === "out" ? otherName : player.name;

  return (
    <Details summary="Transfer pixels with another player">
      <form action={transferPlayerPixels} className="flex flex-col gap-4">
        <input type="hidden" name="here" value={player.id} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="direction" value={direction} />

        <div className="grid items-end gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="hc-segmented" role="tablist" aria-label="Direction">
            {(["out", "in"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={direction === d}
                className="hc-segmented-item px-3"
                onClick={() => {
                  setDirection(d);
                  setOther(null);
                }}
              >
                {d === "out" ? "Send" : "Receive"}
              </button>
            ))}
          </div>

          <PlayerPicker
            key={direction}
            name="other"
            label={direction === "out" ? "Send to" : "Receive from"}
            placeholder={direction === "out" ? "Search the receiving player" : "Search the sending player"}
            excludeId={player.id}
            onSelect={setOther}
          />

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

        <p className="hc-caption text-sm">
          {direction === "out" ? (
            <>
              {player.name} has <strong>{balance}</strong> pixels. A transfer can&apos;t take the balance below zero.
              Player-to-player transfers are logged in the pixel log and shown to both players.
            </>
          ) : (
            <>
              {player.name} has <strong>{balance}</strong> pixels. The pixels will come out of the other player&apos;s
              balance, and both sides will be notified.
            </>
          )}
        </p>

        {overBalance && (
          <p className="hc-caption text-sm" style={{ color: "var(--hc-red)" }}>
            That&apos;s more than {player.name} has.
          </p>
        )}

        <Field label="Reason" hint="Required. Shown to both players and in the pixel log.">
          <Textarea name="reason" required rows={2} placeholder="e.g. Moving pixels to the right account" />
        </Field>

        <div>
          <ActionButton
            variant="primary"
            pendingLabel="Transferring..."
            disabled={!other || !validAmount || overBalance}
            confirm={
              other && validAmount
                ? `Move ${amount} pixels from ${fromName} to ${toName}?`
                : undefined
            }
          >
            {validAmount ? `Transfer ${amount} pixels` : "Transfer pixels"}
          </ActionButton>
        </div>
      </form>
    </Details>
  );
}
