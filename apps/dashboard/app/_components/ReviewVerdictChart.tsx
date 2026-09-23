"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface VerdictCounts {
  approved: number;
  firstPass: number;
  changes: number;
  rejected: number;
}

export interface VerdictWindow {
  key: string;
  label: string;
  counts: VerdictCounts;
}

// Fixed hue per category (never cycled), reused across every time window so a
// bar's color always means the same verdict. Distinct from VERDICT_LABEL in
// ReviewDetailTabs.tsx on purpose - that badge list conflates "approved" and
// "approved (first pass)" under one "success" color since the label text
// already tells them apart there, but a chart needs the two visually
// separated to be readable at a glance.
const BUCKETS: {
  key: keyof VerdictCounts;
  label: string;
  bar: string;
  text: string;
}[] = [
  { key: "approved", label: "Approved (final)", bar: "bg-emerald-500 dark:bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400" },
  { key: "firstPass", label: "Approved (first pass)", bar: "bg-blue-500 dark:bg-blue-600", text: "text-blue-700 dark:text-blue-400" },
  { key: "changes", label: "Req changes", bar: "bg-amber-500 dark:bg-amber-600", text: "text-amber-700 dark:text-amber-400" },
  { key: "rejected", label: "Rejected", bar: "bg-rose-500 dark:bg-rose-600", text: "text-rose-700 dark:text-rose-400" },
];

export function ReviewVerdictChart({ windows }: { windows: VerdictWindow[] }) {
  return (
    <Tabs defaultValue={windows[0]?.key ?? "all"}>
      <TabsList>
        {windows.map((w) => (
          <TabsTrigger key={w.key} value={w.key}>
            {w.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {windows.map((w) => {
        const total = BUCKETS.reduce((s, b) => s + w.counts[b.key], 0);
        const max = Math.max(1, ...BUCKETS.map((b) => w.counts[b.key]));
        return (
          <TabsContent key={w.key} value={w.key} className="pt-4">
            {total === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No reviews in this window.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {BUCKETS.map((b) => {
                  const count = w.counts[b.key];
                  const pct = Math.round((count / max) * 100);
                  return (
                    <div
                      key={b.key}
                      className="flex items-center gap-3"
                      title={`${b.label}: ${count}`}
                    >
                      <div className="w-44 shrink-0 text-right text-sm text-muted-foreground">
                        {b.label}
                      </div>
                      <div className="h-6 flex-1 overflow-hidden rounded-md bg-muted">
                        <div
                          className={`h-full rounded-md ${b.bar} transition-[width]`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className={`w-10 shrink-0 text-sm font-semibold tabular-nums ${b.text}`}>
                        {count}
                      </div>
                    </div>
                  );
                })}
                <div className="pt-1 text-xs text-muted-foreground">
                  {total} review{total === 1 ? "" : "s"} in this window
                </div>
              </div>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
