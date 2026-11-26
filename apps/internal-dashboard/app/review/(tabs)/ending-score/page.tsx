import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { staffName } from "@/lib/staffName";
import { db } from "@/lib/db";
import {
  APPROVAL_POINTS,
  ENDING_SCORE_END,
  ENDING_SCORE_START,
  OTHER_POINTS,
  endingScores,
  type ScoreAudit,
} from "@/lib/endingScore";
import { Badge, Card, CardHeader, EmptyRow, Muted, Stat, StatGrid, Table, formatDateTime } from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

// Every verdict logged since the contest started, paged so a busy weekend never
// hits the row cap of a single query.
async function auditsSinceStart(): Promise<ScoreAudit[]> {
  const rows: ScoreAudit[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("review_audits")
      .select("reviewer, verdict, created_at")
      .gte("created_at", new Date(ENDING_SCORE_START).toISOString())
      .lte("created_at", new Date(ENDING_SCORE_END).toISOString())
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) {
      console.error("ending score", error.message);
      break;
    }
    rows.push(...((data ?? []) as ScoreAudit[]));
    if ((data ?? []).length < page) break;
  }
  return rows;
}

export default async function EndingScorePage() {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  const rows = endingScores(await auditsSinceStart());
  const me = rows.find((r) => r.key === access.session.slackId);
  const now = Date.now();
  const over = now > ENDING_SCORE_END;
  const msLeft = ENDING_SCORE_END - now;
  const daysLeft = Math.max(0, Math.floor(msLeft / 86_400_000));
  const hoursLeft = Math.max(0, Math.floor((msLeft % 86_400_000) / 3_600_000));
  const totalPoints = rows.reduce((s, r) => s + r.points, 0);

  return (
    <div className="flex flex-col gap-6">
      <StatGrid>
        <Stat
          label="Time left"
          icon="clock"
          value={over ? "Over" : `${daysLeft}d ${hoursLeft}h`}
          hint={`Ends ${formatDateTime(new Date(ENDING_SCORE_END).toISOString())} UTC`}
        />
        <Stat
          label="Your score"
          icon="leaders"
          value={me ? `${me.points} pts` : "0 pts"}
          hint={me ? `Rank ${me.rank} of ${rows.length}` : "Not on the board yet"}
        />
        <Stat label="Points handed out" icon="analytics" value={totalPoints} hint={`${rows.length} reviewers`} />
      </StatGrid>

      <Card padding="flush">
        <CardHeader title="Pixl ending score" icon="leaders" count={rows.length} />
        <p className="hc-caption px-4 py-3 text-sm">
          An approval is {APPROVAL_POINTS} points, a change request or a ban is {OTHER_POINTS} point. Counted from{" "}
          {formatDateTime(new Date(ENDING_SCORE_START).toISOString())} to Monday November 30th, 11:59 PM UTC. An
          approval a final reviewer removes (bad review or justification) stops counting. The top 3 win a $10 food
          grant if the first-pass queue is empty by the deadline.
        </p>
        <Table headers={["Rank", "Reviewer", "Approvals", "Changes / bans", "Points"]}>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="hc-mono font-bold">{r.rank}</td>
              <td className="font-bold break-words">
                {staffName(r.reviewer)}
                {r.key === access.session.slackId && (
                  <>
                    {" "}
                    <Badge tone="info">you</Badge>
                  </>
                )}
              </td>
              <td className="hc-mono">{r.approvals}</td>
              <td className="hc-mono">{r.others}</td>
              <td className="hc-mono font-bold text-[var(--hc-green)]">{r.points}</td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow colSpan={5} title="No reviews counted yet" icon="history" />}
        </Table>
      </Card>
      <Muted className="text-xs">Updates live, straight from the review log.</Muted>
    </div>
  );
}
