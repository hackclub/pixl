import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { staffName } from "@/lib/staffName";
import { db, payoutTotalsBySlackId, type ReviewAuditRow } from "@/lib/db";
import { ReviewVerdictChart, type VerdictWindow } from "@/app/_components/ReviewVerdictChart";
import { WEEKLY_REVIEW_MINIMUM, countReviewsSince, reviewWeekStartMs, slackIdFromLabel, summarizeWindow } from "@/lib/reviewStats";
import { ActionButton, Badge, Card, CardHeader, EmptyRow, Flash, Muted, Table, TextLink, formatDate } from "@/app/_ui/ui";
import { claimReviewerFoodGrant } from "@/app/actions";
import { config } from "@/app/_generated/config";
import { getReviewGrantView, progressLine, progressPct } from "@/lib/reviewGrants";
import { reviewerPlayerId, reviewerPlayerIds } from "../reviewerLinks";

export const dynamic = "force-dynamic";

interface ReviewerStats {
  reviewer: string;
  total: number;
  /** Outcome reviews since Saturday 00:00 UTC, against WEEKLY_REVIEW_MINIMUM. */
  thisWeek: number;
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
  if (secs <= 0) return "-";
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

export default async function ReviewStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  const { error: flashError, ok: flashOk } = await searchParams;
  const grant = await getReviewGrantView(access.session.slackId);
  const [{ data, error }, payoutTotals] = await Promise.all([
    db.from("review_audits").select("*").order("created_at", { ascending: false }).limit(2000),
    payoutTotalsBySlackId(),
  ]);
  if (error) console.error("review stats", error.message);
  const audits = (data ?? []) as ReviewAuditRow[];
  // The board is open to anyone who can reach /review. Avg time stays
  // owner-only: it's a moderation signal about a reviewer, not a scoreboard
  // stat, and reading it as a ranking gets it wrong.
  const showAuditColumns = access.isOwner;

  // Calendar windows in UTC (packages/config's convention). "This week" is the
  // review week: Saturday 00:00 to Friday 23:59, not a rolling 7 days.
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekStart = reviewWeekStartMs(now.getTime());
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
    ...summarizeWindow(audits, w.since, staffName),
  }));

  // Owners can open a reviewer's own Pixl account (the players pages are
  // owner-only).
  const reviewerIds = access.isOwner ? await reviewerPlayerIds(audits.map((a) => a.reviewer)) : new Map<string, string>();
  const reviewerLink = (label: string) => reviewerPlayerId(reviewerIds, label);

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
      thisWeek: countReviewsSince(rows, weekStart),
      approved: approved.length,
      firstPass: rows.filter((r) => r.verdict === "first_pass_approved").length,
      changes: rows.filter((r) => r.verdict === "needs_changes").length,
      reverted: rows.filter((r) => r.verdict === "reverted").length,
      hoursCredited: Math.round(approved.reduce((s, r) => s + (Number(r.approved_hours) || 0), 0) * 10) / 10,
      // Actual pixels paid out (review_payouts.paid_pixels), never recomputed
      // at today's rate: payout rates have changed over time.
      pixelsWon: slackId ? (payoutTotals.get(slackId)?.earnedPixels ?? 0) : 0,
      avgSeconds: timed.length > 0 ? timed.reduce((s, r) => s + r.total_seconds, 0) / timed.length : 0,
      lastActive: rows[0]?.created_at ?? "",
    };
  });
  stats.sort((a, b) => b.total - a.total);

  // The viewer's own week against the minimum. A new week starts Saturday 00:00 UTC.
  const myWeek = stats.find((s) => slackIdFromLabel(s.reviewer) === access.session.slackId)?.thisWeek ?? 0;
  const myWeekPct = Math.min(100, Math.round((myWeek / WEEKLY_REVIEW_MINIMUM) * 100));
  const daysLeftInWeek = Math.max(1, Math.ceil((weekStart + 7 * 86_400_000 - now.getTime()) / 86_400_000));

  const headers = [
    "Reviewer",
    "Reviews",
    "This week",
    "Approved",
    "First pass",
    "Changes",
    "Hours credited",
    "Pixels won",
    ...(showAuditColumns ? ["Avg time"] : []),
    "Last active",
  ];

  return (
    <div className="flex flex-col gap-6">
      <Flash error={flashError} ok={flashOk} />
      <Card>
        <CardHeader title="Your week" icon="clock" />
        <p className="hc-caption mb-3 text-sm">
          Every reviewer is expected to do at least {WEEKLY_REVIEW_MINIMUM} reviews a week. A week runs from Saturday
          00:00 UTC to Friday 23:59 UTC.
        </p>
        <div
          className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]"
          role="progressbar"
          aria-valuenow={myWeekPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-[var(--hc-green)]" style={{ width: `${myWeekPct}%` }} />
        </div>
        <p className="text-sm font-bold">
          {myWeek >= WEEKLY_REVIEW_MINIMUM
            ? `${myWeek} reviews this week, minimum reached.`
            : `${myWeek} of ${WEEKLY_REVIEW_MINIMUM} reviews this week, ${WEEKLY_REVIEW_MINIMUM - myWeek} to go (${daysLeftInWeek} day${daysLeftInWeek === 1 ? "" : "s"} left).`}
        </p>
      </Card>
      {grant && (
        <Card>
          <CardHeader title="Your food grants" icon="purse-fill" />
          <p className="hc-caption mb-3 text-sm">
            Every review counts. A $20 food grant (220 px) unlocks at {grant.status.milestones.join(", ")} reviews, one
            each, and you still buy it.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {grant.status.milestones.map((m, i) => {
              const reached = grant.status.reviews >= m;
              const claimed = i < grant.status.claimed;
              return (
                <Badge key={m} tone={claimed ? "neutral" : reached ? "success" : "warning"}>
                  {m} reviews: {claimed ? "claimed" : reached ? "ready" : `${m - grant.status.reviews} to go`}
                </Badge>
              );
            })}
          </div>
          <div
            className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={progressPct(grant.status)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-[var(--hc-green)]" style={{ width: `${progressPct(grant.status)}%` }} />
          </div>
          <p className="mb-3 text-sm font-bold">{progressLine(grant.status)}</p>
          {grant.status.available > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={claimReviewerFoodGrant}>
                <ActionButton icon="purse-fill" pendingLabel="Claiming..." disabled={!grant.itemId}>
                  Claim a food grant (220 px)
                </ActionButton>
              </form>
              <Muted className="text-sm">
                {grant.status.available} available, or buy it from{" "}
                {grant.itemId ? (
                  <TextLink href={`${config.urls.site}/shop/${grant.itemId}`} external>
                    the shop
                  </TextLink>
                ) : (
                  "the shop"
                )}
                .
              </Muted>
            </div>
          ) : (
            <Muted className="text-sm">
              {grant.status.next_at == null ? "You've claimed every grant." : "Nothing to claim right now."}
            </Muted>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Verdicts over time" icon="analytics" />
        <p className="hc-caption mb-4 text-sm">Every review verdict across the whole team, by outcome.</p>
        <ReviewVerdictChart windows={verdictWindows} />
      </Card>

      <Card padding="flush">
        <CardHeader title="Reviewers" icon="leaders" count={stats.length} />
        <p className="hc-caption px-4 py-3 text-sm">
          From the review audit log: verdicts, hours credited and pixels won per reviewer
          {showAuditColumns ? ", plus time spent per review." : "."} Pixels won is the lifetime total actually
          paid out, at whatever rate was in effect at the time.
        </p>
        <Table headers={headers}>
          {stats.map((s) => {
            const rushed = s.avgSeconds > 0 && s.avgSeconds < 60;
            return (
              <tr key={s.reviewer}>
                <td className="font-bold break-words">
                  {reviewerLink(s.reviewer) ? (
                    <TextLink href={`/players/${reviewerLink(s.reviewer)}`}>{staffName(s.reviewer)}</TextLink>
                  ) : (
                    staffName(s.reviewer)
                  )}
                </td>
                <td className="hc-mono">{s.total}</td>
                <td
                  className={`hc-mono ${s.thisWeek >= WEEKLY_REVIEW_MINIMUM ? "font-bold text-[var(--hc-green)]" : ""}`}
                  title={`Minimum is ${WEEKLY_REVIEW_MINIMUM} reviews a week`}
                >
                  {s.thisWeek} / {WEEKLY_REVIEW_MINIMUM}
                </td>
                <td className="hc-mono font-bold text-[var(--hc-green)]">{s.approved}</td>
                <td className="hc-mono">{s.firstPass}</td>
                <td className="hc-mono">{s.changes}</td>
                <td className="hc-mono">{s.hoursCredited}h</td>
                <td className="hc-mono">{s.pixelsWon.toLocaleString()} px</td>
                {showAuditColumns && (
                  <td>
                    {rushed ? (
                      <span title="Under a minute per review. Rubber-stamping?">
                        <Badge tone="danger" icon="important">
                          {fmtDur(s.avgSeconds)}
                        </Badge>
                      </span>
                    ) : (
                      <span className="hc-mono">{fmtDur(s.avgSeconds)}</span>
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap">
                  <Muted>{s.lastActive ? formatDate(s.lastActive) : "-"}</Muted>
                </td>
              </tr>
            );
          })}
          {stats.length === 0 && <EmptyRow colSpan={headers.length} title="No reviews logged yet" icon="history" />}
        </Table>
      </Card>
    </div>
  );
}
