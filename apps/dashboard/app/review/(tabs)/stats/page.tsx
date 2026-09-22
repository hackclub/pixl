import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { db, type ReviewAuditRow } from "@/lib/db";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface ReviewerStats {
  reviewer: string;
  total: number;
  approved: number;
  firstPass: number;
  changes: number;
  reverted: number;
  hoursCredited: number;
  avgSeconds: number;
  repoOpenedPct: number;
  demoOpenedPct: number;
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
  const { data, error } = await db
    .from("review_audits")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) console.error("review stats", error.message);
  const audits = (data ?? []) as ReviewAuditRow[];
  // The board itself is open to anyone who can already reach /review - this
  // used to filter down to the viewer's own row unless they were a super.
  // The two anti-abuse columns (avg time, repo/demo open rate) stay
  // super-only below: they're moderation signals about a reviewer, not a
  // scoreboard stat, and reading them as a ranking gets them wrong.
  const showAuditColumns = access.isSuper;

  const byReviewer = new Map<string, ReviewAuditRow[]>();
  for (const a of audits) {
    const list = byReviewer.get(a.reviewer) ?? [];
    list.push(a);
    byReviewer.set(a.reviewer, list);
  }
  const stats: ReviewerStats[] = [...byReviewer.entries()].map(([reviewer, rows]) => {
    const approved = rows.filter((r) => r.verdict === "approved");
    const timed = rows.filter((r) => (r.total_seconds ?? 0) > 0);
    return {
      reviewer,
      total: rows.length,
      approved: approved.length,
      firstPass: rows.filter((r) => r.verdict === "first_pass_approved").length,
      changes: rows.filter((r) => r.verdict === "needs_changes").length,
      reverted: rows.filter((r) => r.verdict === "reverted").length,
      hoursCredited:
        Math.round(approved.reduce((s, r) => s + (Number(r.approved_hours) || 0), 0) * 10) / 10,
      avgSeconds:
        timed.length > 0
          ? timed.reduce((s, r) => s + r.total_seconds, 0) / timed.length
          : 0,
      repoOpenedPct:
        rows.length > 0
          ? Math.round((rows.filter((r) => r.repo_opened).length / rows.length) * 100)
          : 0,
      demoOpenedPct:
        rows.length > 0
          ? Math.round((rows.filter((r) => r.demo_opened).length / rows.length) * 100)
          : 0,
      lastActive: rows[0]?.created_at ?? "",
    };
  });
  stats.sort((a, b) => b.total - a.total);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Reviewer stats</h1>
      <p className="text-sm text-muted-foreground mb-5">
        From the review audit log , verdicts and hours credited per reviewer
        {showAuditColumns
          ? ", plus time spent per review and whether the repo/demo were actually opened."
          : "."}
      </p>

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
                {showAuditColumns ? (
                  <>
                    <TableHead className="p-3 font-medium" title="Average time spent on the review page per verdict">
                      Avg time
                    </TableHead>
                    <TableHead className="p-3 font-medium" title="How often the repo / demo were actually opened">
                      Repo / demo
                    </TableHead>
                  </>
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
                  {showAuditColumns ? (
                    <>
                      <TableCell
                        className={`p-3 tabular-nums ${
                          s.avgSeconds > 0 && s.avgSeconds < 60 ? "text-rose-600 dark:text-rose-400 font-semibold" : ""
                        }`}
                        title={s.avgSeconds > 0 && s.avgSeconds < 60 ? "Under a minute per review , rubber-stamping?" : undefined}
                      >
                        {fmtDur(s.avgSeconds)}
                      </TableCell>
                      <TableCell className="p-3 tabular-nums">
                        <span className={s.repoOpenedPct < 50 ? "text-rose-600 dark:text-rose-400" : ""}>
                          {s.repoOpenedPct}%
                        </span>{" "}
                        /{" "}
                        <span className={s.demoOpenedPct < 50 ? "text-rose-600 dark:text-rose-400" : ""}>
                          {s.demoOpenedPct}%
                        </span>
                      </TableCell>
                    </>
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
