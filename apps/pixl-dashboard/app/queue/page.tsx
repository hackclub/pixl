import type { Metadata } from "next";
import Link from "next/link";
import { Notice, badgeVariants, buttonVariants, panel, wrap } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { publicQueueStats } from "@/lib/queue-stats";

export const metadata: Metadata = {
  title: "Queue",
  description:
    "Live aggregate counts and review pace for the Pixl project review queue. No project positions or identities.",
};

// The stats come from apps/server's service-key-gated admin route, and the
// page should show current numbers rather than a build-time snapshot.
export const dynamic = "force-dynamic";

interface QueuePayload {
  generated_at: string;
  queue: {
    total: number;
    waiting: { total: number; software: number; hardware: number };
    final_checks: { total: number; software: number; hardware: number };
  };
  activity: {
    reviewed_24h: { approved: number; needs_changes: number };
    reviewed_7d: { approved: number; needs_changes: number; approval_rate: number | null };
    daily: { date: string; approved: number; needs_changes: number }[];
    momentum: {
      verdicts_24h: number;
      avg_per_day_7d: number;
      state: "stalled" | "slowing" | "steady" | "moving_fast";
    };
    turnaround: { median_days: number; sample_size: number } | null;
  };
}

const MOMENTUM: Record<
  QueuePayload["activity"]["momentum"]["state"],
  { label: string; tone: "red" | "gold" | "teal" | "green" }
> = {
  stalled: { label: "STALLED", tone: "red" },
  slowing: { label: "SLOWING", tone: "gold" },
  steady: { label: "STEADY", tone: "teal" },
  moving_fast: { label: "MOVING FAST", tone: "green" },
};

const metricBox = "border-2 border-stroke bg-panel-2 px-3 py-2.5";
const metricLabel = "font-pixel text-[10.5px] uppercase tracking-[1.2px] text-dim";
const metricValue = "mt-1 font-pixel text-[24px] leading-none text-ink tabular-nums";
const metricSub = "mt-1 text-[12px] leading-[1.35] text-faint";

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
}

function Legend({ color, text, value }: { color: string; text: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn("size-[10px] shrink-0 border border-stroke", color)} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-dim">{text}</span>
      <span className="font-pixel text-[14px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

function QueueHeading() {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-pixel text-[32px] leading-none font-semibold tracking-[1.5px] text-ink">
          PIXL <span className="text-gold">QUEUE</span>
        </h1>
        <p className="mt-2 text-[13.5px] text-dim">Live aggregate view of the review pipeline.</p>
      </div>
      <span className="inline-flex items-center gap-2 border-2 border-stroke bg-panel-2 px-2.5 py-1.5 font-pixel text-[11px] tracking-[1px] text-ink">
        <span className="size-[8px] bg-good" /> LIVE
      </span>
    </div>
  );
}

function QueueFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={wrap}>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="font-pixel text-[16px] font-medium tracking-[1px] text-dim hover:text-ink"
        >
          ← PIXL
        </Link>
        <nav className="flex flex-wrap gap-2">
          <Link href="/explore" className={buttonVariants({ variant: "ghost" })}>
            EXPLORE
          </Link>
          <Link href="/dashboard" className={buttonVariants({ variant: "dark" })}>
            DASHBOARD
          </Link>
        </nav>
      </header>
      <div className="mx-auto max-w-[780px]">{children}</div>
      <footer className="mx-auto mt-8 max-w-[780px] border-t-2 border-stroke pt-3 text-[12px] text-faint">
        Official Pixl review queue stats. Aggregate only - never project positions or identities.
      </footer>
    </main>
  );
}

export default async function QueuePage() {
  const data = await publicQueueStats<QueuePayload>();

  if (!data) {
    return (
      <QueueFrame>
        <QueueHeading />
        <Notice tone="bad">Couldn&apos;t load the review queue right now. Try again in a bit.</Notice>
      </QueueFrame>
    );
  }

  const { queue, activity } = data;
  const momentum = MOMENTUM[activity.momentum.state] ?? MOMENTUM.steady;
  const chartMax = Math.max(1, ...activity.daily.map((d) => d.approved + d.needs_changes));
  const reviewed24 = activity.reviewed_24h.approved + activity.reviewed_24h.needs_changes;
  const reviewed7 = activity.reviewed_7d.approved + activity.reviewed_7d.needs_changes;
  const barTotal = Math.max(1, queue.total);
  const updated = `${timeLabel(data.generated_at)} UTC`;

  return (
    <QueueFrame>
      <QueueHeading />

      <section className={cn(panel, "p-5 sm:p-7")} aria-labelledby="pipeline-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="pipeline-title" className="font-pixel text-[13px] uppercase tracking-[2px] text-ink">
              Review Pipeline
            </h2>
            <p className="mt-1 text-[12.5px] text-faint">
              Comparing 24h pace against the 7-day average
            </p>
          </div>
          <span className={badgeVariants({ tone: momentum.tone })}>{momentum.label}</span>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="font-pixel text-[56px] leading-[.95] tracking-[1px] text-ink tabular-nums">
            {queue.waiting.total}
          </span>
          <span className="pb-1 text-[14px] text-dim">projects waiting for review</span>
        </div>

        <div
          className="mt-4 flex h-[16px] overflow-hidden border-2 border-stroke bg-panel-deep"
          role="img"
          aria-label={`${queue.waiting.software} software, ${queue.waiting.hardware} hardware, ${queue.final_checks.total} in final checks`}
        >
          {queue.waiting.software > 0 ? (
            <div
              className="h-full bg-teal"
              style={{ width: `${(queue.waiting.software / barTotal) * 100}%` }}
            />
          ) : null}
          {queue.waiting.hardware > 0 ? (
            <div
              className="h-full bg-gold"
              style={{ width: `${(queue.waiting.hardware / barTotal) * 100}%` }}
            />
          ) : null}
          {queue.final_checks.total > 0 ? (
            <div
              className="h-full bg-accent"
              style={{ width: `${(queue.final_checks.total / barTotal) * 100}%` }}
            />
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Legend color="bg-teal" text="Software queue" value={queue.waiting.software} />
          <Legend color="bg-gold" text="Hardware queue" value={queue.waiting.hardware} />
          <Legend color="bg-accent" text="Passed first review" value={queue.final_checks.total} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className={metricBox}>
            <div className={metricLabel}>7-day approval rate</div>
            <div className={metricValue}>
              {activity.reviewed_7d.approval_rate === null
                ? "—"
                : `${activity.reviewed_7d.approval_rate}%`}
            </div>
            <div className={metricSub}>
              {activity.reviewed_7d.approved} approved · {activity.reviewed_7d.needs_changes} needs changes
            </div>
          </div>
          <div className={metricBox}>
            <div className={metricLabel}>Median turnaround</div>
            <div className={metricValue}>
              {activity.turnaround ? `~${activity.turnaround.median_days}d` : "—"}
            </div>
            <div className={metricSub}>
              {activity.turnaround
                ? `first ship to verdict · n=${activity.turnaround.sample_size}`
                : "not enough completed reviews yet"}
            </div>
          </div>
          <div className={metricBox}>
            <div className={metricLabel}>Verdicts · 24h</div>
            <div className={metricValue}>{reviewed24}</div>
            <div className={metricSub}>
              {activity.reviewed_24h.approved} approved · {activity.reviewed_24h.needs_changes} needs changes
            </div>
          </div>
        </div>

        <div className="mt-6 border-t-2 border-stroke pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-pixel text-[11.5px] uppercase tracking-[1.5px] text-ink">
              14-day verdict activity
            </h3>
            <div className="flex flex-wrap gap-3 text-[12px] text-dim">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[9px] border border-stroke bg-good" /> Approved
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[9px] border border-stroke bg-gold" /> Needs changes
              </span>
            </div>
          </div>

          <div className="mt-3 flex h-[124px] items-end gap-[4px] border-b-2 border-stroke">
            {activity.daily.map((d) => {
              const total = d.approved + d.needs_changes;
              return (
                <div
                  key={d.date}
                  className="flex h-full flex-1 items-end"
                  title={`${dayLabel(d.date)} · ${d.approved} approved · ${d.needs_changes} needs changes`}
                >
                  {total > 0 ? (
                    <div
                      className="flex w-full flex-col justify-end"
                      style={{ height: `${Math.max(4, (total / chartMax) * 100)}%` }}
                    >
                      {d.needs_changes > 0 ? (
                        <div
                          className="w-full bg-gold"
                          style={{ height: `${(d.needs_changes / total) * 100}%` }}
                        />
                      ) : null}
                      {d.approved > 0 ? (
                        <div
                          className="w-full bg-good"
                          style={{ height: `${(d.approved / total) * 100}%` }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="h-[2px] w-full bg-stroke" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-faint">
            <span>{dayLabel(activity.daily[0].date)}</span>
            <span>{dayLabel(activity.daily[Math.floor(activity.daily.length / 2)].date)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t-2 border-stroke pt-4">
          <div className="text-[13px] text-dim">
            <b className="text-ink">{reviewed7}</b> verdicts in the last 7 days
            <span className="text-faint">
              {" "}
              · updated {updated} · refreshes at most every 30s
            </span>
          </div>
          <div className="text-[11px] text-faint">Aggregate only · no project positions</div>
        </div>
      </section>
    </QueueFrame>
  );
}
