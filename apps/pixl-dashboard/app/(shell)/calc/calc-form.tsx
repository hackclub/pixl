"use client";

// Calculator inputs. Holds no formulas: every change rewrites the URL
// (?rows=hours:tier,...&base=&project=) and the Server Component recomputes the
// numbers with calc/economy.ts, so the browser only ever sees results.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { field, selectField } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export interface CalcInputs {
  rows: { hours: number; tier: number }[];
  base: boolean;
  project: string;
}

export interface ProjectOption {
  id: string;
  label: string;
}

function toQuery(v: CalcInputs, withNumbers: boolean): string {
  const p = new URLSearchParams();
  if (v.project) p.set("project", v.project);
  if (withNumbers) {
    p.set("rows", v.rows.map((r) => `${r.hours}:${r.tier}`).join(","));
  }
  if (v.base) p.set("base", "1");
  return p.toString();
}

export function useCalcNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const go = (v: CalcInputs, withNumbers = true) => {
    const qs = toQuery(v, withNumbers);
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { go, pending };
}

const lbl = "mb-1.5 block text-[13px] text-faint";
const stepperBtn = cn(
  "flex flex-1 items-center justify-center p-0 cursor-px",
  "border-2 border-r-4 border-b-4 border-stroke bg-panel-2 text-ink",
  "transition-[background-color,color] duration-[130ms] hover:bg-gold hover:text-btn-ink",
);

const Chevron = ({ up }: { up: boolean }) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-2.5 [image-rendering:pixelated]">
    {up ? (
      <>
        <rect x="7" y="4" width="2" height="2" />
        <rect x="5" y="6" width="6" height="2" />
        <rect x="3" y="8" width="10" height="2" />
      </>
    ) : (
      <>
        <rect x="3" y="6" width="10" height="2" />
        <rect x="5" y="8" width="6" height="2" />
        <rect x="7" y="10" width="2" height="2" />
      </>
    )}
  </svg>
);

export function ProjectPicker({ value, options, inputs }: { value: string; options: ProjectOption[]; inputs: CalcInputs }) {
  const { go, pending } = useCalcNav();
  return (
    <select
      className={selectField}
      aria-label="Pick a project"
      value={value}
      disabled={pending}
      // Picking a project drops hours/tier from the URL so the server fills
      // them from that project's tracked hours and tier.
      onChange={(e) => go({ ...inputs, project: e.target.value }, !e.target.value)}
    >
      <option value="">Select a project</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const MAX_ROWS = 20;

interface RowState {
  key: number;
  hours: string;
  tier: number;
}

export function CalcForm({
  initial,
  tiers,
  baseLabel,
  canUseBase,
  rowSummaries,
}: {
  initial: CalcInputs;
  tiers: readonly string[];
  baseLabel: string;
  canUseBase: boolean;
  /** Server-computed "px · RE" text per row, so the browser holds no formulas. */
  rowSummaries: string[];
}) {
  const nextKey = useRef(initial.rows.length);
  const [rows, setRows] = useState<RowState[]>(() =>
    (initial.rows.length ? initial.rows : [{ hours: 10, tier: 1 }]).map((r, i) => ({ key: i, hours: String(r.hours), tier: r.tier })),
  );
  const [base, setBase] = useState(initial.base);
  const { go } = useCalcNav();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(
      () =>
        go({
          rows: rows.map((r) => ({ hours: Math.max(Number(r.hours) || 0, 0), tier: r.tier })),
          base,
          project: initial.project,
        }),
      250,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, base]);

  const update = (key: number, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function step(key: number, dir: number) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const next = Math.max((Number(row.hours) || 0) + dir * 0.5, 0);
    update(key, { hours: String(Math.round(next * 100) / 100) });
  }

  return (
    <>
      {rows.map((row, i) => (
        <div key={row.key} className={cn("mt-3.5", rows.length > 1 && "border-2 border-stroke bg-panel-2 p-3.5")}>
          {rows.length > 1 ? (
            <div className="mb-2 flex items-center justify-between">
              <span className="font-pixel text-[11px] uppercase tracking-[1px] text-gold">PROJECT {i + 1}</span>
              <span className="flex items-center gap-3">
                <span className="text-[12px] tabular-nums text-faint">{rowSummaries[i] ?? ""}</span>
                <button
                  type="button"
                  className="cursor-px text-[12px] text-faint underline hover:text-bad"
                  aria-label={`Remove project ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                >
                  remove
                </button>
              </span>
            </div>
          ) : null}
          <label className={lbl} htmlFor={`calc-hours-${row.key}`}>
            Hours
          </label>
          <div className="flex items-stretch gap-2">
            <input
              id={`calc-hours-${row.key}`}
              className={cn(
                field,
                "min-w-0 flex-1 [appearance:textfield]",
                "[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none",
                "[&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none",
              )}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={row.hours}
              onChange={(e) => update(row.key, { hours: e.target.value })}
            />
            <div className="flex w-9 flex-col gap-[5px]">
              <button type="button" className={stepperBtn} aria-label="Increase hours" onClick={() => step(row.key, 1)}>
                <Chevron up />
              </button>
              <button type="button" className={stepperBtn} aria-label="Decrease hours" onClick={() => step(row.key, -1)}>
                <Chevron up={false} />
              </button>
            </div>
          </div>
          <label className={cn(lbl, "mt-3.5")} htmlFor={`calc-tier-${row.key}`}>
            Tier (your call, the reviewer confirms it)
          </label>
          <select
            id={`calc-tier-${row.key}`}
            className={selectField}
            value={row.tier}
            onChange={(e) => update(row.key, { tier: Number(e.target.value) || 1 })}
          >
            {tiers.map((t, ti) => (
              <option key={t} value={ti + 1}>
                {t}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="mt-3.5">
        <button
          type="button"
          className={cn(stepperBtn, "w-full flex-none px-3 py-2 text-[13px] disabled:opacity-50")}
          disabled={rows.length >= MAX_ROWS}
          onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, hours: "10", tier: 1 }])}
        >
          + ADD ANOTHER PROJECT
        </button>
      </div>
      <div className="mt-3.5">
        <label className="relative flex cursor-px items-center gap-2.5">
          <input
            type="checkbox"
            className="peer absolute size-px opacity-0"
            checked={base}
            disabled={!canUseBase}
            onChange={(e) => setBase(e.target.checked)}
          />
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center border-2 border-r-4 border-b-4 border-stroke bg-panel-2 text-btn-ink",
              "transition-[background-color] duration-[130ms] peer-checked:bg-gold peer-disabled:opacity-50",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold",
              "[&_svg]:opacity-0 peer-checked:[&_svg]:opacity-100",
            )}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
              <rect x="3" y="8" width="2" height="2" />
              <rect x="5" y="10" width="2" height="2" />
              <rect x="7" y="8" width="2" height="2" />
              <rect x="9" y="6" width="2" height="2" />
              <rect x="11" y="4" width="2" height="2" />
            </svg>
          </span>
          <span className="text-[13px] text-ink">Include my base RE</span>
          <span className="ml-auto font-pixel text-xs text-gold">{baseLabel}</span>
        </label>
      </div>
    </>
  );
}
