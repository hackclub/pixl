import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { db, payoutTotalsBySlackId, type ReviewAuditRow } from "@/lib/db";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReviewVerdictChart, type VerdictWindow } from "@/app/_components/ReviewVerdictChart";
import { slackIdFromLabel, summarizeWindow } from "@/lib/reviewStats";

export const dynamic = "force-dynamic";

interface ReviewerStats {
  reviewer: string;
  total: number;
  approved: number;
  firstPass: number;
  changes: number;
  reverted: number;
  hoursCredited: number;
  pixelsWon: number;
  avgSeconds: number;
  lastActive: string;
}

function fmtDur(secs: number): string {
  if (secs <= 0) return ",";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

export default async function ReviewStatsPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  const [{ data, error }, payoutTotals] = await Promise.all([
    db.from("review_audits").select("*").order("created_at", { ascending: false }).limit(2000),
    payoutTotalsBySlackId(),
  ]);
  if (error) console.error("review stats", error.message);
  const audits = (data ?? []) as ReviewAuditRow[];
  // The board itself is open to anyone who can already reach /review - this
  // used to filter down to the viewer's own row unless they were a super.
  // Avg time stays super-only below: it's a moderation signal about a
  // reviewer, not a scoreboard stat, and reading it as a ranking gets it
  // wrong (repo/demo-open-rate used to live here too, removed in favor of
  // lifetime pixels won, a real scoreboard stat everyone can see).
  const showAuditColumns = access.isSuper;

  // Calendar windows in UTC (see packages/config's own UTC convention) -
  // "this week" starts Monday, matching an ISO week rather than a rolling
  // 7-day lookback.
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const weekStart = dayStart - daysSinceMonday * 86_400_000;
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const windowDefs: { key: string; label: string; since: number | null }[] = [
    { key: "all", label: "All time", since: null },
    { key: "day", label: "Today", since: dayStart },
    { key: "week", label: "This week", since: weekStart },
    { key: "month", label: "This month", since: monthStart },
  ];
  const verdictWindows: VerdictWindow[] = windowDefs.map((w) => ({
    key: w.key,
    label: w.label,
    ...summarizeWindow(audits, w.since),
  }));

  const byReviewer = new Map<string, ReviewAuditRow[]>();
  for (const a of audits) {
    const list = byReviewer.get(a.reviewer) ?? [];
    list.push(a);
    byReviewer.set(a.reviewer, list);
  }
  const stats: ReviewerStats[] = [...byReviewer.entries()].map(([reviewer, rows]) => {
    const approved = rows.filter((r) => r.verdict === "approved");
    const timed = rows.filter((r) => (r.total_seconds ?? 0) > 0);
    const slackId = slackIdFromLabel(reviewer);
    return {
      reviewer,
      total: rows.length,
      approved: approved.length,
      firstPass: rows.filter((r) => r.verdict === "first_pass_approved").length,
      changes: rows.filter((r) => r.verdict === "needs_changes").length,
      reverted: rows.filter((r) => r.verdict === "reverted").length,
      hoursCredited:
        Math.round(approved.reduce((s, r) => s + (Number(r.approved_hours) || 0), 0) * 10) / 10,
      // Actual pixels paid out historically (review_payouts.paid_pixels),
      // never recomputed at today's rate - review payout rates have changed
      // over time (see updateReviewPayoutSettings), so this is the real sum
      // of what each payout was worth when it was actually paid, not what
      // the same review count would be worth today.
      pixelsWon: slackId ? (payoutTotals.get(slackId)?.earnedPixels ?? 0) : 0,
      avgSeconds:
        timed.length > 0
          ? timed.reduce((s, r) => s + r.total_seconds, 0) / timed.length
          : 0,
      lastActive: rows[0]?.created_at ?? "",
    };
  });
  stats.sort((a, b) => b.total - a.total);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Reviewer stats</h1>
      <p className="text-sm text-muted-foreground mb-5">
        From the review audit log , verdicts, hours credited, and pixels won per reviewer
        {showAuditColumns ? ", plus time spent per review." : "."}
      </p>

      <Card className="p-4 mb-8">
        <div className="font-pixel text-xl mb-1">Verdicts over time</div>
        <p className="text-sm text-muted-foreground mb-3">
          Every review verdict across the whole team, by outcome.
        </p>
        <ReviewVerdictChart windows={verdictWindows} />
      </Card>

      {stats.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">No reviews logged yet.</Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-3 font-medium">Reviewer</TableHead>
                <TableHead className="p-3 font-medium">Reviews</TableHead>
                <TableHead className="p-3 font-medium">Approved</TableHead>
                <TableHead className="p-3 font-medium">First pass</TableHead>
                <TableHead className="p-3 font-medium">Changes</TableHead>
                <TableHead className="p-3 font-medium">Hours credited</TableHead>
                <TableHead className="p-3 font-medium" title="Lifetime pixels actually paid out for reviewing, at whatever rate was in effect at the time">
                  Pixels won
                </TableHead>
                {showAuditColumns ? (
                  <TableHead className="p-3 font-medium" title="Average time spent on the review page per verdict">
                    Avg time
                  </TableHead>
                ) : null}
                <TableHead className="p-3 font-medium">Last active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((s) => (
                <TableRow key={s.reviewer} className="hover:bg-transparent">
                  <TableCell className="p-3 font-medium break-words">{s.reviewer}</TableCell>
                  <TableCell className="p-3 tabular-nums">{s.total}</TableCell>
                  <TableCell className="p-3 tabular-nums text-hc-green font-medium">{s.approved}</TableCell>
                  <TableCell className="p-3 tabular-nums">{s.firstPass}</TableCell>
                  <TableCell className="p-3 tabular-nums">{s.changes}</TableCell>
                  <TableCell className="p-3 tabular-nums">{s.hoursCredited}h</TableCell>
                  <TableCell className="p-3 tabular-nums font-medium">{s.pixelsWon.toLocaleString()} px</TableCell>
                  {showAuditColumns ? (
                    <TableCell
                      className={`p-3 tabular-nums ${
                        s.avgSeconds > 0 && s.avgSeconds < 60 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""
                      }`}
                      title={s.avgSeconds > 0 && s.avgSeconds < 60 ? "Under a minute per review , rubber-stamping?" : undefined}
                    >
                      {fmtDur(s.avgSeconds)}
                    </TableCell>
                  ) : null}
                  <TableCell className="p-3 text-muted-foreground">
                    {s.lastActive ? new Date(s.lastActive).toLocaleDateString() : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
