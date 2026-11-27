"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { searchPlayers, type PlayerHit } from "@/app/actions";
import { Field, Input } from "@/app/_ui/ui";

// Typeahead that submits the chosen player's id under `name` (only once a hit
// is picked). Shared by the pixel adjust and transfer forms.
export function PlayerPicker({
  name = "userId",
  label = "Player",
  hint,
  placeholder = "Search player",
  excludeId,
  onSelect,
}: {
  name?: string;
  label?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  excludeId?: string | null;
  onSelect?: (hit: PlayerHit | null) => void;
}) {
  const [player, setPlayer] = useState("");
  const [selected, setSelected] = useState<PlayerHit | null>(null);
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && player === selected.name) {
      setOpen(false);
      return;
    }
    const q = player.trim();
    if (q.length < 2) {
      setHits([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    setOpen(true);
    const t = setTimeout(async () => {
      try {
        setHits(await searchPlayers(q));
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [player, selected]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visible = excludeId ? hits.filter((h) => h.id !== excludeId) : hits;

  return (
    <Field label={label} hint={hint}>
      <div ref={boxRef} className="relative">
        {selected && <input type="hidden" name={name} value={selected.id} />}
        <Input
          autoComplete="off"
          value={player}
          onChange={(e) => {
            setPlayer(e.target.value);
            setSelected(null);
            onSelect?.(null);
          }}
          onFocus={() => visible.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required
          className="w-full"
        />
        {open && (
          <ul className="hc-select-menu">
            {searching && visible.length === 0 && <li className="hc-select-option hc-muted">Searching...</li>}
            {visible.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="hc-select-option"
                  onClick={() => {
                    setSelected(h);
                    setPlayer(h.name);
                    setOpen(false);
                    onSelect?.(h);
                  }}
                >
                  <span className="truncate">{h.name}</span>
                </button>
              </li>
            ))}
            {!searching && visible.length === 0 && (
              <li className="hc-select-option hc-muted">No players found.</li>
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}
