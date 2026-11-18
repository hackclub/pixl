"use client";

import { useState, useTransition } from "react";
import { loadProjectFileTime, type ProjectFileTime } from "@/app/actions";
import { actionErrorMessage } from "@/app/_ui/actionError";
import { Button, Card, CardHeader, Muted } from "@/app/_ui/ui";

// "Time by file" for the review page: where the Hackatime hours went, file by
// file, and how much was spent outside the project folder (terminal, AI tools,
// notes that are not in the repo). Loaded on demand because it costs one
// Hackatime request per coding day.

function fmt(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function FileTimeCard({ projectId, hasHackatime }: { projectId: number; hasHackatime: boolean }) {
  const [pending, start] = useTransition();
  const [data, setData] = useState<ProjectFileTime | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    start(async () => {
      try {
        setData(await loadProjectFileTime(projectId));
      } catch (e) {
        setError(actionErrorMessage(e, "load the time by file"));
      }
    });
  };

  return (
    <Card>
      <CardHeader title="Time by file" icon="code" />
      {!hasHackatime ? (
        <Muted className="text-sm">No Hackatime project is linked.</Muted>
      ) : (
        <>
          {!data && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={load} disabled={pending}>
                {pending ? "Loading..." : "Load time by file"}
              </Button>
              <Muted className="text-xs">Reads the heartbeats from Hackatime, can take a few seconds.</Muted>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-[var(--hc-red)]">{error}</p>}
          {data && !data.ok && <p className="text-sm text-[var(--hc-red)]">{data.error}</p>}
          {data?.ok &&
            data.people.map((person) => {
              const r = person.report;
              const max = Math.max(1, ...r.files.map((f) => f.seconds));
              return (
                <div key={person.name} className="mb-4 last:mb-0">
                  {data.people.length > 1 && <p className="hc-eyebrow mb-2">{person.name}</p>}
                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <p className="hc-caption text-xs">Total</p>
                      <p className="hc-mono font-bold">{fmt(r.totalSeconds)}</p>
                    </div>
                    <div>
                      <p className="hc-caption text-xs">In the project</p>
                      <p className="hc-mono font-bold">{fmt(r.inProjectSeconds)}</p>
                    </div>
                    <div>
                      <p className="hc-caption text-xs">Outside the project</p>
                      <p className="hc-mono font-bold">{fmt(r.outsideSeconds)}</p>
                    </div>
                    <div>
                      <p className="hc-caption text-xs">Markdown files</p>
                      <p className="hc-mono font-bold">{fmt(r.markdownSeconds)}</p>
                    </div>
                  </div>
                  {r.missingDays > 0 && (
                    <p className="hc-caption mb-2 text-xs">
                      {r.missingDays} day{r.missingDays === 1 ? "" : "s"} could not be loaded, so the totals may be short.
                    </p>
                  )}
                  <ul className="flex flex-col gap-1 text-sm">
                    {r.files.map((f) => (
                      <li key={`${f.inProject ? 1 : 0}:${f.path}`} className="flex items-center gap-2">
                        <span className="hc-mono w-16 shrink-0 text-right">{fmt(f.seconds)}</span>
                        <span
                          className="h-2 shrink-0 rounded-full"
                          style={{
                            width: `${Math.max(2, Math.round((f.seconds / max) * 80))}px`,
                            background: f.inProject ? "var(--hc-blue)" : "#e0701f",
                          }}
                        />
                        <span className="min-w-0 break-all">
                          {f.path}
                          {!f.inProject && <span className="hc-caption text-xs"> (outside the project)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {r.otherSeconds > 0 && (
                    <p className="hc-caption mt-2 text-xs">+ {fmt(r.otherSeconds)} spread over smaller files</p>
                  )}
                </div>
              );
            })}
        </>
      )}
    </Card>
  );
}
