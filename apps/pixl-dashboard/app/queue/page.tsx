import type { Metadata } from "next";
import Link from "next/link";
import {
  PageHeader,
  Notice,
  badgeVariants,
  buttonVariants,
  panel,
  wrap,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { publicQueueStats } from "@/lib/queue-stats";

export const metadata: Metadata = {
  title: "Review queue",
  description:
    "Live aggregate counts and review pace for the Pixl project review queue. No project positions or identities.",
};

// The stats come from apps/server's service-key-gated admin route, and the
// page should show current numbers rather than a build-time snapshot.
export const dynamic = "force-dynamic";

interface QueuePayload {
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
    pace: {
      software: { reviews_per_day: number; eta_days: number | null };
      hardware: { reviews_per_day: number; eta_days: number | null };
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

const label = "font-pixel text-[11px] uppercase tracking-[1.5px] text-dim";
const big = "font-pixel text-[30px] leading-none tracking-[.5px] text-ink tabular-nums";
const sub = "text-[13px] leading-[1.45] text-dim";
const cardTitle = "font-pixel text-[13px] uppercase tracking-[2px] text-ink";

function fmtDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return "<1 day";
  if (days < 10) return `${days.toFixed(1)} days`;
  return `${Math.round(days)} days`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function Legend({ color, text, value }: { color: string; text: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-[10px] shrink-0 border border-stroke", color)} />
      <span className="flex-1 text-[13.5px] text-dim">{text}</span>
      <span className="font-pixel text-[14px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

function QueueFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className={wrap}>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="font-pixel text-[28px] font-semibold tracking-[1.5px] text-ink hover:text-gold-soft"
          title="Pixl"
        >
          PIXL
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
      {children}
      <footer className="mt-8 border-t-2 border-stroke pt-3 text-[12px] text-faint">
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
        <PageHeader title="REVIEW QUEUE" sub="WHAT'S WAITING, AND HOW FAST IT'S MOVING" />
        <Notice tone="bad">Couldn&apos;t load the review queue right now. Try again in a bit.</Notice>
      </QueueFrame>
    );
  }

  const { queue, activity } = data;
  const momentum = MOMENTUM[activity.momentum.state] ?? MOMENTUM.steady;
  const chartMax = Math.max(
    1,
    ...activity.daily.map((d) => d.approved + d.needs_changes),
  );
  const reviewed24 = activity.reviewed_24h.approved + activity.reviewed_24h.needs_changes;

  return (
    <QueueFrame>
      <PageHeader title="REVIEW QUEUE" sub="WHAT'S WAITING, AND HOW FAST IT'S MOVING" />
      <p className="mb-4 max-w-[720px] text-dim">
        Live aggregate numbers from the Pixl review pipeline. Project details, queue positions and
        who is reviewing what stay private.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <section className={cn(panel, "p-[18px]")} aria-labelledby="pipeline-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="pipeline-heading" className={cardTitle}>
                Review pipeline
              </h2>
              <div className={label}>Projects in review</div>
            </div>
            <div className="text-right">
              <div className={big}>{queue.total}</div>
              <div className={label}>total</div>
            </div>
          </div>

          <div
            className="mt-4 flex h-[18px] overflow-hidden border-2 border-stroke bg-panel-deep"
            role="img"
            aria-label={`${queue.waiting.software} software, ${queue.waiting.hardware} hardware, ${queue.final_checks.total} in final checks`}
          >
            {queue.waiting.software > 0 ? (
              <div className="h-full bg-teal" style={{ width: `${(queue.waiting.software / Math.max(1, queue.total)) * 100}%` }} />
            ) : null}
            {queue.waiting.hardware > 0 ? (
              <div className="h-full bg-gold" style={{ width: `${(queue.waiting.hardware / Math.max(1, queue.total)) * 100}%` }} />
            ) : null}
            {queue.final_checks.total > 0 ? (
              <div className="h-full bg-accent" style={{ width: `${(queue.final_checks.total / Math.max(1, queue.total)) * 100}%` }} />
            ) : null}
          </div>

          <div className="mt-4 grid gap-[7px]">
            <Legend color="bg-teal" text="Software waiting for first review" value={queue.waiting.software} />
            <Legend color="bg-gold" text="Hardware waiting for first review" value={queue.waiting.hardware} />
            <Legend color="bg-accent" text="Passed first review, in final checks" value={queue.final_checks.total} />
          </div>
        </section>

        <section className={cn(panel, "p-[18px]")} aria-labelledby="pace-heading">
          <h2 id="pace-heading" className={cardTitle}>
            Pace
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="border-2 border-stroke bg-panel-2 p-3">
              <div className={label}>Software ETA</div>
              <div className="mt-1 font-pixel text-[24px] leading-none text-ink">
                {fmtDays(activity.pace.software.eta_days)}
              </div>
              <div className={cn(sub, "mt-1")}>
                {activity.pace.software.reviews_per_day}/day · {queue.waiting.software} waiting
              </div>
            </div>
            <div className="border-2 border-stroke bg-panel-2 p-3">
              <div className={label}>Hardware ETA</div>
              <div className="mt-1 font-pixel text-[24px] leading-none text-ink">
                {fmtDays(activity.pace.hardware.eta_days)}
              </div>
              <div className={cn(sub, "mt-1")}>
                {activity.pace.hardware.reviews_per_day}/day · {queue.waiting.hardware} waiting
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className={label}>Turnaround</div>
              <div className="mt-1 font-pixel text-[22px] leading-none text-ink">
                {activity.turnaround ? `~${activity.turnaround.median_days}d` : "—"}
              </div>
              <div className={cn(sub, "mt-1")}>
                {activity.turnaround
                  ? `first ship to verdict · n=${activity.turnaround.sample_size}`
                  : "not enough completed reviews yet"}
              </div>
            </div>
            <div>
              <div className={label}>Approval rate · 7d</div>
              <div className="mt-1 font-pixel text-[22px] leading-none text-ink">
                {activity.reviewed_7d.approval_rate === null ? "—" : `${activity.reviewed_7d.approval_rate}%`}
              </div>
              <div className={cn(sub, "mt-1")}>
                {activity.reviewed_7d.approved} approved · {activity.reviewed_7d.needs_changes} needs changes
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className={cn(panel, "mt-4 p-[18px]")} aria-labelledby="activity-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="activity-heading" className={cardTitle}>
              Verdicts
            </h2>
            <div className={label}>Last 14 days</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={badgeVariants({ tone: momentum.tone })}>{momentum.label}</span>
            <span className="text-[13px] text-dim">
              {activity.momentum.verdicts_24h} in 24h · {activity.momentum.avg_per_day_7d}/day 7d avg
            </span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <div className={label}>Verdicts · 24h</div>
            <div className={big}>{reviewed24}</div>
            <div className={cn(sub, "mt-1")}>
              {activity.reviewed_24h.approved} approved · {activity.reviewed_24h.needs_changes} needs changes
            </div>
          </div>
          <div>
            <div className={label}>Verdicts · 7d</div>
            <div className={big}>{activity.reviewed_7d.approved + activity.reviewed_7d.needs_changes}</div>
            <div className={cn(sub, "mt-1")}>
              {activity.reviewed_7d.approved} approved · {activity.reviewed_7d.needs_changes} needs changes
            </div>
          </div>
          <div>
            <div className={label}>Momentum</div>
            <div className="mt-1 font-pixel text-[18px] leading-none text-ink">{momentum.label}</div>
            <div className={cn(sub, "mt-1")}>{activity.momentum.avg_per_day_7d}/day average</div>
          </div>
        </div>

        <div className="mt-5 flex h-[132px] items-end gap-[4px] border-b-2 border-stroke">
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
                      <div className="w-full bg-gold" style={{ height: `${(d.needs_changes / total) * 100}%` }} />
                    ) : null}
                    {d.approved > 0 ? (
                      <div className="w-full bg-good" style={{ height: `${(d.approved / total) * 100}%` }} />
                    ) : null}
                  </div>
                ) : (
                  <div className="h-[2px] w-full bg-stroke" />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[12px] text-faint">
          <span>{dayLabel(activity.daily[0].date)}</span>
          <span>{dayLabel(activity.daily[Math.floor(activity.daily.length / 2)].date)}</span>
          <span>Today</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-dim">
          <span className="inline-flex items-center gap-2">
            <span className="size-[10px] border border-stroke bg-good" /> Approved
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="size-[10px] border border-stroke bg-gold" /> Needs changes
          </span>
        </div>
      </section>

      <p className="mt-4 text-[13px] text-faint">
        Counts update from the review pipeline. A project&apos;s spot in the queue is only visible to
        reviewers; this page deliberately never shows project names, positions or wait times.
      </p>
    </QueueFrame>
  );
}
