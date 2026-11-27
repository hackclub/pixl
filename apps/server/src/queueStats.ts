import { db } from "./db/client.js";
import { sql } from "./db/pgCompat.js";

// Projects sitting in the review queue. They are deliberately absent from the
// public project list and detail responses: ReviewQ-style tools rebuild the
// queue order from status + shipped_at + review history, so publishing those
// rows lets anyone derive a maker's position in the shared queue.
// needs_changes is NOT here: that is back with the maker, not waiting on us.
export const IN_REVIEW_STATUSES = ["shipped", "fraud_review", "second_review"] as const;

const HARDWARE_PROJECT_TYPES = new Set(["hardware", "cad"]);
const DAY_MS = 86_400_000;
export const ACTIVITY_DAYS = 14;

export interface QueueCounts {
  /** Everything currently in review (first pass + final checks). */
  total: number;
  /** Waiting for their first review. */
  waiting: { total: number; software: number; hardware: number };
  /** Passed first review, waiting on the fraud check or spot check. */
  final_checks: { total: number; software: number; hardware: number };
}

export interface QueueActivity {
  reviewed_24h: { approved: number; needs_changes: number };
  reviewed_7d: { approved: number; needs_changes: number; approval_rate: number | null };
  /** Oldest first, one entry per UTC day. */
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
}

export interface QueueStats {
  generated_at: string;
  queue: QueueCounts;
  activity: QueueActivity;
}

/** Aggregate queue counts from project status/type rows. No identities. */
export function queueCounts(
  rows: { status?: string | null; project_type?: string | null }[],
): QueueCounts {
  const waiting = { total: 0, software: 0, hardware: 0 };
  const final_checks = { total: 0, software: 0, hardware: 0 };
  for (const row of rows) {
    const bucket =
      row.status === "shipped"
        ? waiting
        : row.status === "fraud_review" || row.status === "second_review"
          ? final_checks
          : null;
    if (!bucket) continue;
    bucket.total += 1;
    if (row.project_type && HARDWARE_PROJECT_TYPES.has(row.project_type)) bucket.hardware += 1;
    else bucket.software += 1;
  }
  return { total: waiting.total + final_checks.total, waiting, final_checks };
}

function timeMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Verdict pace and 14-day activity from review_audits rows. Aggregate only:
 * no project ids, names, reviewers or per-project verdicts leave this function.
 */
export function queueActivity(
  verdicts: { verdict?: string | null; created_at?: string | Date | null; project_type?: string | null }[],
  counts: QueueCounts,
  turnaroundRows: { first_shipped_at?: string | Date | null; first_verdict?: string | Date | null }[],
  now = Date.now(),
): QueueActivity {
  const since24 = now - DAY_MS;
  const since7 = now - 7 * DAY_MS;
  let approved24 = 0;
  let changes24 = 0;
  let approved7 = 0;
  let changes7 = 0;
  let softwareReviews7 = 0;
  let hardwareReviews7 = 0;

  const daily = new Map<string, { date: string; approved: number; needs_changes: number }>();
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const date = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    daily.set(date, { date, approved: 0, needs_changes: 0 });
  }

  for (const row of verdicts) {
    const at = timeMs(row.created_at);
    if (at === null || at > now) continue;
    const approved = row.verdict === "approved";
    const needsChanges = row.verdict === "needs_changes";
    if (!approved && !needsChanges) continue;
    if (at >= since24) {
      if (approved) approved24 += 1;
      else changes24 += 1;
    }
    if (at >= since7) {
      if (approved) approved7 += 1;
      else changes7 += 1;
      if (row.project_type && HARDWARE_PROJECT_TYPES.has(row.project_type)) hardwareReviews7 += 1;
      else softwareReviews7 += 1;
    }
    const bucket = daily.get(new Date(at).toISOString().slice(0, 10));
    if (bucket) {
      if (approved) bucket.approved += 1;
      else bucket.needs_changes += 1;
    }
  }

  const verdicts24 = approved24 + changes24;
  const total7 = approved7 + changes7;
  const avgPerDay7 = total7 / 7;
  let state: QueueActivity["momentum"]["state"];
  if (avgPerDay7 === 0) state = verdicts24 === 0 ? "stalled" : "moving_fast";
  else if (verdicts24 >= avgPerDay7 * 1.5) state = "moving_fast";
  else if (verdicts24 < avgPerDay7 * 0.5) state = verdicts24 === 0 ? "stalled" : "slowing";
  else state = "steady";

  const paceFor = (reviews7: number, waiting: number) => {
    const reviews_per_day = round1(reviews7 / 7);
    return {
      reviews_per_day,
      eta_days: reviews_per_day > 0 ? round1(waiting / reviews_per_day) : null,
    };
  };

  const windows = turnaroundRows
    .map((row) => {
      const shipped = timeMs(row.first_shipped_at);
      const verdict = timeMs(row.first_verdict);
      if (shipped === null || verdict === null) return null;
      const days = (verdict - shipped) / DAY_MS;
      return days >= 0 && days <= 365 ? days : null;
    })
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  let turnaround: QueueActivity["turnaround"] = null;
  if (windows.length > 0) {
    const mid = Math.floor(windows.length / 2);
    const median =
      windows.length % 2 ? windows[mid] : (windows[mid - 1] + windows[mid]) / 2;
    turnaround = { median_days: round1(median), sample_size: windows.length };
  }

  return {
    reviewed_24h: { approved: approved24, needs_changes: changes24 },
    reviewed_7d: {
      approved: approved7,
      needs_changes: changes7,
      approval_rate: total7 > 0 ? round1((approved7 / total7) * 100) : null,
    },
    daily: [...daily.values()],
    momentum: { verdicts_24h: verdicts24, avg_per_day_7d: round1(avgPerDay7), state },
    pace: {
      software: paceFor(softwareReviews7, counts.waiting.software),
      hardware: paceFor(hardwareReviews7, counts.waiting.hardware),
    },
    turnaround,
  };
}

/** Load the aggregate queue + verdict stats. Throws on a database failure. */
export async function loadQueueStats(now = Date.now()): Promise<QueueStats> {
  const since = new Date(now - ACTIVITY_DAYS * DAY_MS).toISOString();
  const [projects, verdictRows, turnaroundRows] = await Promise.all([
    db
      .from("projects")
      .select("status, project_type")
      .in("status", [...IN_REVIEW_STATUSES])
      .is("archived_at", null)
      .is("rejected_at", null)
      .is("banned_at", null),
    sql.unsafe(
      `select a.verdict, a.created_at, p.project_type
         from review_audits a
         join projects p on p.id = a.project_id
        where a.verdict in ('approved', 'needs_changes')
          and a.created_at >= $1::timestamptz
        order by a.created_at asc`,
      [since],
    ) as unknown as Promise<
      { verdict: string; created_at: string | Date; project_type: string | null }[]
    >,
    sql.unsafe(
      `select p.first_shipped_at, min(a.created_at) as first_verdict
         from projects p
         join review_audits a on a.project_id = p.id
        where a.verdict in ('approved', 'needs_changes')
          and p.id in (
            select project_id from review_audits
             where verdict in ('approved', 'needs_changes')
               and created_at >= $1::timestamptz
          )
        group by p.id, p.first_shipped_at`,
      [since],
    ) as unknown as Promise<
      { first_shipped_at: string | Date | null; first_verdict: string | Date | null }[]
    >,
  ]);
  if (projects.error) throw projects.error;
  const counts = queueCounts(
    (projects.data ?? []) as { status: string; project_type: string | null }[],
  );
  return {
    generated_at: new Date(now).toISOString(),
    queue: counts,
    activity: queueActivity(verdictRows, counts, turnaroundRows, now),
  };
}
