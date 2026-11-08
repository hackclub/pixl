"use client";

import { useReducedMotion } from "motion/react";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import type { PixelFlowPoint } from "@/lib/db";
import { chartUtcDate, dateLabel } from "@/lib/bklitDates";
import { Muted } from "@/app/_ui/ui";
import { BKLIT_THEME } from "./bklitTheme";

const SERIES = [
  { key: "given", label: "Given out", color: "var(--hc-green)" },
  { key: "deducted", label: "Deducted", color: "var(--hc-red)" },
] as const;

export function PixelFlowChart({ points }: { points: PixelFlowPoint[] }) {
  const reduced = useReducedMotion();
  const labels = points.map((p) => dateLabel(p.date));
  const data = points.map((p) => ({ ...p, date: chartUtcDate(p.date) }));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="hc-heading text-base">Pixels</h3>
        <Muted className="text-xs">Given out vs deducted, per day</Muted>
      </div>
      <div className="h-[220px] w-full" style={BKLIT_THEME} aria-hidden="true">
        {data.length === 0 ? (
          <div className="hc-muted flex h-full items-center justify-center text-sm">No pixel activity yet</div>
        ) : (
          <AreaChart data={data} xDataKey="date" aspectRatio="auto" className="h-full"
            animationDuration={reduced ? 0 : 650} margin={{ top: 14, right: 16, bottom: 32, left: 48 }}>
            <Grid horizontal numTicksRows={4} />
            {SERIES.map((s) => (
              <Area key={s.key} dataKey={s.key} stroke={s.color} fill={s.color}
                fillOpacity={0.24} animate={!reduced} />
            ))}
            <XAxis numTicks={3} labels={labels} />
            <YAxis numTicks={4} formatLargeNumbers={false} />
            <ChartTooltip dateLabels={labels} rows={(point) => SERIES.map((s) => ({
              label: s.label, color: s.color, value: Number(point[s.key] ?? 0),
            }))} />
          </AreaChart>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs" aria-label="Pixel flow legend">
        {SERIES.map((s) => <li key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
          <span>{s.label}</span>
        </li>)}
      </ul>
      <table className="sr-only"><caption>Daily pixel flow</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Given out</th><th scope="col">Deducted</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.date}><td>{dateLabel(p.date)}</td><td>{p.given}</td><td>{p.deducted}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
