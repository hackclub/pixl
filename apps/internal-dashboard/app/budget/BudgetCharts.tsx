"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useReducedMotion } from "motion/react";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const colors = ["var(--hc-cyan)", "var(--hc-purple)", "var(--hc-orange)", "var(--hc-green)", "var(--hc-blue)", "var(--hc-yellow)", "var(--hc-red)"];
const theme = { "--foreground": "var(--text)", "--chart-label": "var(--secondary)", "--chart-grid": "var(--border-strong)", "--chart-line-primary": "var(--hc-cyan)", "--chart-foreground-muted": "var(--muted)", "--card": "var(--surface)", "--muted-foreground": "var(--secondary)" } as CSSProperties;

const enterTransition = { duration: 0.6 };
const reducedTransition = { duration: 0 };

export function BudgetCharts({ kind, rows }: { kind: "obligations" | "expenses" | "months"; rows: { label: string; value: number }[] }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [hovered, setHovered] = useState<number | null>(null);
  const positive = rows.filter((row) => row.value > 0);
  if (!mounted) return <div className="h-64" aria-hidden="true" />;
  if (!positive.length) return <p className="hc-caption py-8">No recorded amounts to chart.</p>;
  if (kind === "months") return <div style={theme}>
    <div className="h-64 w-full" aria-hidden="true">
      <BarChart data={rows.map((row) => ({ name: row.label, usd: row.value / 100 }))} aspectRatio="auto" className="h-full" animationDuration={reduced ? 0 : 650} margin={{ top: 25, right: 20, bottom: 40, left: 20 }}>
        <Grid horizontal numTicksRows={4} />
        <Bar dataKey="usd" fill="var(--hc-cyan)" animate={!reduced} showValue valueLabelFormatter={(value) => money(value * 100)} />
        <BarXAxis showAllLabels />
        <ChartTooltip rows={(point) => [{ label: "Supplier cost", value: money(Number(point.usd) * 100), color: "var(--hc-cyan)" }]} />
      </BarChart>
    </div>
    <ul className="my-3 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Monthly supplier costs">{rows.map((row) => <li key={row.label}>{row.label}: <strong>{money(row.value)}</strong></li>)}</ul>
  </div>;
  const data = positive.map((row, i) => ({ ...row, color: colors[i % colors.length] }));
  return <div className="my-4 grid items-center gap-4 min-w-0 sm:grid-cols-[220px_minmax(0,1fr)]" style={theme}>
    <div className="mx-auto h-[220px] w-[220px]" aria-hidden="true">
      <PieChart data={data} size={220} innerRadius={70} padAngle={0.025} cornerRadius={4} hoveredIndex={hovered} onHoverChange={setHovered} enterTransition={reduced ? reducedTransition : enterTransition}>
        {data.map((row, i) => <PieSlice key={row.label} index={i} animate={!reduced} hoverEffect={reduced ? "none" : "grow"} />)}
        <PieCenter defaultLabel={kind === "expenses" ? "Cash sent" : "Reserved"}>{({ value, label }) => <div className="text-center"><div className="text-xl font-bold tabular-nums">{money(value)}</div><div className="hc-caption mt-1 max-w-28 text-xs">{label}</div></div>}</PieCenter>
      </PieChart>
    </div>
    <ul className="space-y-2 text-sm" aria-label={kind === "expenses" ? "Cash expenses in USD" : "Reserves in USD"}>{data.map((row, i) => <li key={row.label}>
      <button type="button" className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2" onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />{row.label}</span><strong className="tabular-nums">{money(row.value)}</strong>
      </button>
    </li>)}</ul>
  </div>;
}

export function RemainingBudget({ cashCents, reservedCents }: { cashCents: number | null; reservedCents: number }) {
  const [extra, setExtra] = useState("");
  const valid = extra === "" || (/^\d+(\.\d{0,2})?$/.test(extra) && Number.isFinite(Number(extra)) && Number(extra) <= 1_000_000_000);
  const remaining = cashCents !== null && valid ? cashCents - reservedCents - Math.round(Number(extra || 0) * 100) : null;
  return <div>
    <dl className="space-y-4 text-sm">
      <div className="flex justify-between gap-4"><dt>Cash in HCB</dt><dd className="font-bold tabular-nums">{cashCents === null ? "Unavailable" : money(cashCents)}</dd></div>
      <div className="flex justify-between gap-4"><dt>Reward reserves</dt><dd className="tabular-nums">−{money(reservedCents)}</dd></div>
    </dl>
    <label className="mt-6 block text-sm font-bold" htmlFor="budget-extra">Additional unpaid costs (USD)</label>
    <p id="budget-extra-help" className="hc-caption mt-1 text-xs">Optional scenario for a bounty, invoice or shipping cost not in HCB yet. Blank means no extra scenario cost, not that unknown bills are zero.</p>
    <input id="budget-extra" type="text" inputMode="decimal" placeholder="e.g. 900.00" value={extra} onChange={(event) => setExtra(event.target.value)} aria-invalid={!valid} aria-describedby="budget-extra-help budget-extra-error" className="mt-2 w-full rounded-lg border border-current/25 bg-transparent px-3 py-2 tabular-nums" />
    <p id="budget-extra-error" className="mt-1 text-sm" role={valid ? undefined : "alert"}>{!valid && "Enter a non-negative USD amount with up to two decimal places."}</p>
    <div className="mt-6 border-t border-current/15 pt-5" aria-live="polite"><p className="hc-caption text-xs">{extra ? "Remaining after scenario cost" : "Remaining before unknown costs"}</p><p className="mt-1 text-4xl font-bold tabular-nums" style={remaining !== null && remaining < 0 ? { color: "var(--hc-red)" } : undefined}>{remaining === null ? "Unavailable" : money(remaining)}</p></div>
  </div>;
}
