"use client";

import { useState } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import type { HackatimeReport, HackatimeBreakdown, LapseTimelapse } from "@/lib/hackatime";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

function fmtDate(unix: number | null): string {
  if (!unix) return ",";
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtSecs(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Breakdown({ title, items }: { title: string; items: HackatimeBreakdown[] }) {
  const top = items.filter((i) => i.seconds > 0).slice(0, 10);
  if (top.length === 0) return null;

  const row: Record<string, number> = {};
  const config: ChartConfig = {};
  top.forEach((i, n) => {
    const key = `s${n}`;
    row[key] = i.percent;
    config[key] = { label: i.name };
  });

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <ChartContainer config={config} className="aspect-auto h-2.5 w-full">
        <BarChart layout="vertical" data={[row]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" hide />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          {top.map((i, n) => (
            <Bar
              key={n}
              dataKey={`s${n}`}
              stackId="a"
              fill={i.color || "var(--color-brand)"}
            />
          ))}
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {top.map((i, n) => (
          <div key={n} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: i.color || "var(--color-brand)" }} />
            <span className="text-foreground/75">{i.name}</span>
            <span className="text-muted-foreground tabular-nums">{i.text}</span>
            <span className="text-muted-foreground/70 tabular-nums">{i.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Toggles a small inline player instead of opening a new tab/window - the
// reviewer stays on the review page, the video just expands under the chip.
function LapseChip({ lapse }: { lapse: LapseTimelapse }) {
  const [open, setOpen] = useState(false);

  if (!lapse.playbackUrl) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1 text-xs text-muted-foreground"
        title="Still processing"
      >
        {lapse.name} (processing…)
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs hover:bg-muted"
        title={lapse.name}
      >
        {open ? "▼" : "▶"} {lapse.name}
        {lapse.duration > 0 && (
          <span className="text-muted-foreground tabular-nums">{fmtSecs(lapse.duration)}</span>
        )}
      </button>
      {open && (
        <video
          src={lapse.playbackUrl}
          poster={lapse.thumbnailUrl ?? undefined}
          controls
          className="mt-1.5 w-48 rounded-md border border-border bg-black"
        />
      )}
    </div>
  );
}

export function HackatimePanel({ report }: { report: HackatimeReport }) {
  const linked = report.projects.filter((p) => p.linked);
  const maxSecs = Math.max(1, ...report.projects.map((p) => p.seconds));

  const ProjectRow = (p: HackatimeReport["projects"][number]) => (
    <div key={p.name} className="p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-medium text-sm">{p.name}</span>
        {p.linked && <Badge variant="success">linked</Badge>}
        <Badge variant="secondary">{p.text}</Badge>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">{p.percent}% of all-time</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
        <div className="h-full bg-[color:var(--color-hc-blue)]" style={{ width: `${(p.seconds / maxSecs) * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>{p.sessions > 0 ? `${p.sessions} coding session${p.sessions === 1 ? "" : "s"}` : "no session data"}</span>
        {p.firstActivity && <span>first activity {fmtDate(p.firstActivity)}</span>}
        {p.lastActivity && <span>last activity {fmtDate(p.lastActivity)}</span>}
      </div>
      {p.lapses.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-xs font-semibold text-muted-foreground mb-1.5">
            Lapses to watch ({p.lapses.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {p.lapses.map((l) => (
              <LapseChip key={l.id} lapse={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const linkedSeconds = linked.reduce((s, p) => s + (p.seconds || 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 p-4 border-b border-border">
        <Tile label="Coded on this project" value={fmtSecs(linkedSeconds)} />
        <Tile label="Coding sessions" value={String(linked.reduce((s, p) => s + (p.sessions || 0), 0))} />
      </div>

      <div className="p-4 space-y-4 border-b border-border">
        {report.languages.length > 0 && (
          <Breakdown
            title={report.languagesScoped ? "Languages (this project)" : "Languages (all projects)"}
            items={report.languages}
          />
        )}
        {report.editors.length > 0 && <Breakdown title="Editors" items={report.editors} />}
        {report.operatingSystems.length > 0 && <Breakdown title="Operating systems" items={report.operatingSystems} />}
        {report.machines.length > 0 && <Breakdown title="Machines" items={report.machines} />}
        {report.languages.length === 0 && (
          <div className="text-sm text-muted-foreground">No language breakdown available for this maker.</div>
        )}
      </div>

      <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Projects linked to this submission
      </div>
      <div className="divide-y divide-border">
        {linked.length > 0 ? (
          linked.map(ProjectRow)
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No linked Hackatime projects.</div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="py-0">
      <CardContent className="p-3">
        <div className="text-lg font-bold tabular-nums break-words">{value}</div>
        <div className="text-[0.7rem] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
      </CardContent>
    </Card>
  );
}
