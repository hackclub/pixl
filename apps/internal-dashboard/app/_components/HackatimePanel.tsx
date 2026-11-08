"use client";

import { useState } from "react";
import type { HackatimeReport, HackatimeBreakdown, LapseTimelapse } from "@/lib/hackatime";
import { Badge, Button, EmptyState, formatDate, Muted, Stat, StatGrid } from "@/app/_ui/ui";

function fmtDate(unix: number | null): string {
  if (!unix) return "-";
  return formatDate(unix * 1000);
}

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

import { useEffect } from "react";
import { useReducedMotion } from "motion/react";
import { hackatimeDonutSlices } from "@/lib/hackatimeChart";
import { PieChart } from "@/components/charts/pie-chart";
import { PieSlice } from "@/components/charts/pie-slice";
import { PieCenter } from "@/components/charts/pie-center";
import { BKLIT_THEME } from "@/app/_components/bklitTheme";

type BreakdownKey = "languages" | "editors" | "operatingSystems" | "machines";

function BreakdownExplorer({ report }: { report: HackatimeReport }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState<BreakdownKey>("languages");
  const [hovered, setHovered] = useState<number | null>(null);
  useEffect(() => setMounted(true), []);

  const groups: { key: BreakdownKey; label: string; scope: string; items: HackatimeBreakdown[] }[] = [
    { key: "languages", label: "Languages", scope: report.languagesScoped ? "This submission's linked projects" : "All Hackatime projects", items: report.languages },
    { key: "editors", label: "Editors", scope: "All Hackatime projects", items: report.editors },
    { key: "operatingSystems", label: "Operating systems", scope: "All Hackatime projects", items: report.operatingSystems },
    { key: "machines", label: "Machines", scope: "All Hackatime projects", items: report.machines },
  ];
  const available = groups.filter((g) => g.items.some((i) => Number.isFinite(i.seconds) && i.seconds > 0));
  const active = available.find((g) => g.key === selected) ?? available[0];
  if (!active) return <p className="hc-caption text-sm">No Hackatime breakdown available for this maker.</p>;

  const slices = hackatimeDonutSlices(active.items);
  const totalSeconds = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" style={BKLIT_THEME}
      aria-label="Hackatime time breakdown">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="hc-heading text-sm">Time breakdown</h3>
          <p className="hc-caption text-xs">Explore where the tracked time went.</p>
        </div>
        <span className="hc-caption rounded-md bg-[var(--sunken)] px-2 py-1 text-xs">{active.scope}</span>
      </div>
      {available.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Select a Hackatime breakdown">
          {available.map((g) => (
            <button key={g.key} type="button" aria-pressed={active.key === g.key}
              onClick={() => { setSelected(g.key); setHovered(null); }}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${active.key === g.key
                ? "border-[var(--primary)] bg-[var(--sunken)] text-[var(--text)]"
                : "border-[var(--border)] text-[var(--secondary)] hover:bg-[var(--sunken)]"}`}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid items-center gap-4 sm:grid-cols-[184px_minmax(0,1fr)]">
        <div className="mx-auto h-[184px] w-[184px] shrink-0" aria-hidden="true">
          {mounted && (
            <PieChart key={active.key} data={slices} size={184} innerRadius={57} padAngle={0.026}
              cornerRadius={4} hoveredIndex={hovered} onHoverChange={setHovered}
              enterTransition={{ duration: reduced ? 0 : 0.5 }}>
              {slices.map((slice, i) => (
                <PieSlice key={slice.label} index={i} animate={!reduced}
                  hoverEffect={reduced ? "none" : "grow"} />
              ))}
              <PieCenter defaultLabel="Tracked time">
                {({ value, label }) => (
                  <div className="max-w-[95px] text-center">
                    <div className="text-lg font-bold leading-tight tabular-nums">{fmtSecs(value)}</div>
                    <div className="hc-caption mt-1 line-clamp-2 break-words text-[10px] leading-tight">{label}</div>
                  </div>
                )}
              </PieCenter>
            </PieChart>
          )}
        </div>
        <div className="min-w-0">
          <p className="hc-caption mb-2 text-xs">
            <strong className="text-[var(--text)]">{fmtSecs(totalSeconds)}</strong> across {active.items.filter((r) => Number.isFinite(r.seconds) && r.seconds > 0).length} categories
          </p>
          <ul className="flex flex-col gap-1" aria-label={`${active.label} time share`}>
            {slices.map((slice, i) => (
              <li key={slice.label}>
                <button type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--sunken)] focus-visible:outline-2 focus-visible:outline-offset-2"
                  onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)} onBlur={() => setHovered(null)}
                  aria-label={`${slice.label}: ${fmtSecs(slice.value)}, ${slice.percent.toFixed(1)} percent`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                    <span className="break-words">{slice.label}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">
                    {fmtSecs(slice.value)} <span className="hc-muted font-normal">· {slice.percent.toFixed(1)}%</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="hc-caption mt-3 text-[11px]">Shows reported Hackatime data, not approved hours or a fraud determination.
        {active.key !== "languages" || !report.languagesScoped ? " This breakdown is account-wide." : ""}
      </p>
    </section>
  );
}
// Plays inline under the chip, so the reviewer stays on the review page.
function LapseChip({ lapse }: { lapse: LapseTimelapse }) {
  const [open, setOpen] = useState(false);

  if (!lapse.playbackUrl) {
    return (
      <span title="Still processing">
        <Badge outline>{lapse.name} (processing…)</Badge>
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start">
      <Button
        type="button"
        variant="outline"
        size="sm"
        icon={open ? "down-caret" : "right-caret"}
        onClick={() => setOpen((o) => !o)}
        title={lapse.name}
      >
        {lapse.name}
        {lapse.duration > 0 && <Muted className="tabular-nums">{fmtSecs(lapse.duration)}</Muted>}
      </Button>
      {open && (
        <video
          src={lapse.playbackUrl}
          poster={lapse.thumbnailUrl ?? undefined}
          controls
          className="mt-1.5 w-48 rounded-md border border-[var(--border)] bg-black"
        />
      )}
    </div>
  );
}

export function HackatimePanel({ report }: { report: HackatimeReport }) {
  const linked = report.projects.filter((p) => p.linked);
  const maxSecs = Math.max(1, ...report.projects.map((p) => p.seconds));
  const linkedSeconds = linked.reduce((s, p) => s + (p.seconds || 0), 0);
  const linkedSessions = linked.reduce((s, p) => s + (p.sessions || 0), 0);

  return (
    <div>
      <div className="border-b border-[var(--border)] p-4">
        <StatGrid>
          <Stat label="Coded on this project" value={fmtSecs(linkedSeconds)} icon="clock" />
          <Stat label="Coding sessions" value={linkedSessions} />
        </StatGrid>
      </div>

      <div className="border-b border-[var(--border)] p-4">
        <BreakdownExplorer report={report} />
      </div>

      <p className="hc-eyebrow px-4 pt-4">Projects linked to this submission</p>
      {linked.length === 0 ? (
        <EmptyState title="No linked Hackatime projects" icon="clock" />
      ) : (
        <ul>
          {linked.map((p) => (
            <li key={p.name} className="flex flex-col gap-2 border-b border-[var(--border)] p-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{p.name}</span>
                <Badge tone="success">linked</Badge>
                <Badge>{p.text}</Badge>
                <Muted className="ml-auto text-xs tabular-nums">{p.percent}% of all-time</Muted>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--sunken)]">
                <div className="h-full bg-[var(--hc-blue)]" style={{ width: `${(p.seconds / maxSecs) * 100}%` }} />
              </div>
              <div className="hc-caption flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <span>
                  {p.sessions > 0 ? `${p.sessions} coding session${p.sessions === 1 ? "" : "s"}` : "no session data"}
                </span>
                {p.firstActivity && <span>first activity {fmtDate(p.firstActivity)}</span>}
                {p.lastActivity && <span>last activity {fmtDate(p.lastActivity)}</span>}
              </div>
              {p.lapses.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2">
                  <p className="hc-eyebrow">Lapses to watch ({p.lapses.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {p.lapses.map((l) => (
                      <LapseChip key={l.id} lapse={l} />
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
