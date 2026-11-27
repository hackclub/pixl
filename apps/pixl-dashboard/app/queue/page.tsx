import type { Metadata } from "next";
import Link from "next/link";
import { Notice, buttonVariants, panel, wrap } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { publicQueueStats } from "@/lib/queue-stats";

export const metadata: Metadata = {
  title: "Queue",
  description: "Live aggregate counts for the Pixl project review queue.",
};

// The stats come from apps/server's service-key-gated admin route, and the
// page should show current numbers rather than a build-time snapshot.
export const dynamic = "force-dynamic";

interface QueuePayload {
  generated_at: string;
  queue: {
    total: number;
    waiting: { total: number };
    fraud_review: { total: number };
    second_review: { total: number };
  };
  activity: {
    reviewed_24h: { approved: number; needs_changes: number };
    daily: { date: string; approved: number; needs_changes: number }[];
  };
}

const FIRST_PASS = "#42a5f5";
const FRAUD_REVIEW = "#ab47bc";
const SECOND_PASS = "#f5a623";
const APPROVED = "#22c55e";
const NEEDS_CHANGES = "#ec3750";

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

function QueueHeading() {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-pixel text-[32px] leading-none font-semibold tracking-[1.5px] text-ink">
          PIXL <span className="text-gold">QUEUE</span>
        </h1>
        <p className="mt-2 text-[13.5px] text-dim">Live count of what&apos;s in review.</p>
      </div>
      <span className="inline-flex items-center gap-2 border-2 border-stroke bg-panel-2 px-3 py-1.5 text-[11px] font-bold">
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
  const reviewed24 = activity.reviewed_24h.approved + activity.reviewed_24h.needs_changes;
  const barTotal = Math.max(1, queue.total);
  const updated = `${timeLabel(data.generated_at)} UTC`;

  const stages = [
    { label: "First pass", n: queue.waiting.total, color: FIRST_PASS },
    { label: "Fraud review", n: queue.fraud_review.total, color: FRAUD_REVIEW },
    { label: "Second pass", n: queue.second_review.total, color: SECOND_PASS },
  ];

  const chartW = 420;
  const chartH = 88;
  const chartPad = 6;
  const plotH = chartH - chartPad * 2;
  const chartMax = Math.max(1, ...activity.daily.map((d) => d.approved + d.needs_changes));
  const colW = chartW / Math.max(1, activity.daily.length);
  const barW = Math.min(18, colW - 8);

  return (
    <QueueFrame>
      <QueueHeading />

      <section
        className={cn(panel, "border-4 p-5 shadow-drop sm:p-7")}
        aria-labelledby="pipeline-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="pipeline-title" className="text-[20px] font-bold leading-tight text-ink">
            Review Pipeline
          </h2>
          <span className="text-[11px] font-semibold text-faint">Updated {updated}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-stroke pb-3.5">
          <span className="text-[46px] font-bold leading-none tabular-nums text-ink">
            {queue.total}
          </span>
          <span className="text-[16px] font-semibold text-dim">projects in review</span>
        </div>

        <div
          className="mt-4 flex h-[46px] overflow-hidden border-2 border-stroke bg-panel-2"
          role="img"
          aria-label={`${queue.waiting.total} first pass, ${queue.fraud_review.total} fraud review, ${queue.second_review.total} second pass`}
        >
          {stages.map((s) => (
            <div
              key={s.label}
              className="flex h-full min-w-0 items-center justify-center text-[15px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.55)] not-last:border-r-2 not-last:border-black/25"
              style={{ width: `${(s.n / barTotal) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.n}`}
            >
              {s.n / barTotal >= 0.04 ? s.n : ""}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {stages.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <span
                className="size-[12px] shrink-0 border border-black/30"
                style={{ background: s.color }}
              />
              {s.label}
              <span className="text-faint tabular-nums">{s.n}</span>
            </span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t-2 border-stroke pt-3.5">
          <span className="text-[24px] font-bold leading-none tabular-nums text-ink">{reviewed24}</span>
          <span className="text-[14px] font-semibold text-dim">verdicts in the last 24h</span>
          <span className="text-[13px] font-semibold text-faint">
            ({activity.reviewed_24h.approved} approved · {activity.reviewed_24h.needs_changes} needs changes)
          </span>
        </div>

        <div className="mt-3.5 border-2 border-stroke bg-panel-2 px-3.5 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[12px] font-bold text-ink">14-day verdict activity</span>
            <span className="inline-flex items-center gap-3 text-[11px] font-semibold text-faint">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[9px]" style={{ background: APPROVED }} /> Approved
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-[9px]" style={{ background: NEEDS_CHANGES }} /> Needs changes
              </span>
            </span>
          </div>
          <svg
            className="block h-auto w-full overflow-visible"
            viewBox={`0 0 ${chartW} ${chartH}`}
            role="img"
            aria-label="14-day stacked bar chart of approved and needs-changes verdicts"
          >
            {[0, 0.5, 1].map((frac) => {
              const y = chartPad + plotH * (1 - frac);
              return (
                <line
                  key={frac}
                  x1={0}
                  x2={chartW}
                  y1={y}
                  y2={y}
                  stroke={frac === 0 ? "rgba(0,0,0,.35)" : "rgba(0,0,0,.12)"}
                  strokeWidth={frac === 0 ? 1.5 : 1}
                  strokeDasharray={frac === 0 ? undefined : "3 3"}
                />
              );
            })}
            {activity.daily.map((d, i) => {
              const total = d.approved + d.needs_changes;
              const x = i * colW + (colW - barW) / 2;
              const appH = (d.approved / chartMax) * plotH;
              const ncH = (d.needs_changes / chartMax) * plotH;
              return (
                <g key={d.date}>
                  <title>{`${dayLabel(d.date)} · ${d.approved} approved · ${d.needs_changes} needs changes`}</title>
                  {d.approved > 0 ? (
                    <rect
                      x={x}
                      y={chartPad + plotH - appH}
                      width={barW}
                      height={Math.max(2, appH)}
                      fill={APPROVED}
                    />
                  ) : null}
                  {d.needs_changes > 0 ? (
                    <rect
                      x={x}
                      y={chartPad + plotH - appH - ncH}
                      width={barW}
                      height={Math.max(2, ncH)}
                      fill={NEEDS_CHANGES}
                    />
                  ) : null}
                  {total === 0 ? (
                    <rect
                      x={x}
                      y={chartPad + plotH - 2}
                      width={barW}
                      height={2}
                      fill="rgba(0,0,0,.12)"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="mt-1.5 flex justify-between gap-4 text-[11px] font-semibold text-faint">
            <span>{dayLabel(activity.daily[0].date)}</span>
            <span>{dayLabel(activity.daily[Math.floor(activity.daily.length / 2)].date)}</span>
            <span>Today</span>
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-faint">
          <span>Updated {updated} · refreshes at most every 30s</span>
          <span>Aggregate only · no project positions</span>
        </div>
      </section>
    </QueueFrame>
  );
}
