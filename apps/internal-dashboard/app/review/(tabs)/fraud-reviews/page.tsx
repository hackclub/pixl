import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { listRobertReviews, listSecondReviewProjects, type RobertReviewRow } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { bulkRobertAction } from "@/app/actions";
import { TelescreenReviewTable } from "../TelescreenReviewTable";
import { FRAUD_SCORE_THRESHOLD } from "@/lib/robertOutcome";
import { ActionButton, Badge, Card, Flash, CardHeader, EmptyState, Mono, Muted, StatusBadge, Table, TextLink } from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

function dayKey(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "unknown";
}

function dayLabel(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (key === today) return "Today";
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === yesterday) return "Yesterday";
  return key;
}

function timeLabel(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(11, 16) + " UTC" : "";
}

function fmtHours(hours: number | null): string {
  return hours == null ? "-" : `${Math.round(hours * 10) / 10}h`;
}

function maker(p: RobertReviewRow): string {
  return p.users?.display_name || p.users?.real_name || "Unknown";
}

// Read-only log of every score Robert's fraud reviewer has given, newest
// first, grouped by day. Spot check (supers only) is where a fraud-range
// project actually gets decided; this is the full picture, including the
// projects that already left Spot check.
export default async function FraudReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { done, error } = await searchParams;
  // Final reviewers, owners and fraud reviewers (the fraud_review marker).
  const access = await requirePage({ review: "fraud" });
  // The guidelines gate is for people who review; a fraud reviewer can't.
  if (access.isReviewer) await requireGuidelinesAck(access);

  const viewer = access.session.slackId;
  const canBulk = access.canSecondPass || access.isOwner;
  // A reviewer restricted to one queue only sees that queue's projects.
  const kind = access.reviewQueues === "both" ? undefined : access.reviewQueues;
  const [rows, awaiting, blackoutIds] = await Promise.all([
    listRobertReviews(),
    listSecondReviewProjects(viewer, kind, { includeClaimed: true }),
    listBlackoutQueueProjectIds(),
  ]);
  const handles = await slackHandles(awaiting.flatMap((p) => [p.users?.slack_id, p.claimedBy]));
  const days = new Map<string, RobertReviewRow[]>();
  for (const r of rows) {
    const key = dayKey(r.robert_reviewed_at);
    days.set(key, [...(days.get(key) ?? []), r]);
  }

  return (
    <div className="flex flex-col gap-6">
      <Flash error={error} ok={done} />
      <p className="hc-caption max-w-2xl text-sm">
        Every score Robert&apos;s fraud reviewer has given, newest first. A score of {FRAUD_SCORE_THRESHOLD} or
        below is Robert&apos;s &quot;Fraud&quot; range. Those still go to Spot check for a decision, nothing is
        banned automatically.
      </p>
      {awaiting.length > 0 && (
        <Card padding="flush">
          <CardHeader title="Awaiting Robert" icon="clock" count={awaiting.length} />
          <p className="hc-caption px-4 py-3 text-sm">
            These passed a first review and are parked until Robert&apos;s fraud review lands. They move on to
            Spot check automatically once his score is in.
            {canBulk && " Tick projects to re-push them to Robert or skip his review for all of them."}
          </p>
          {canBulk ? (
            <form action={bulkRobertAction}>
              <input type="hidden" name="back" value="/review/fraud-reviews" />
              <div className="flex flex-wrap items-center gap-3 px-4 pb-3">
                <ActionButton
                  variant="outline"
                  pendingLabel="Re-pushing..."
                  name="bulkAction"
                  value="repush"
                  confirm="Re-push every selected project to Robert?"
                >
                  Re-push selected
                </ActionButton>
                <ActionButton
                  variant="danger"
                  pendingLabel="Skipping..."
                  name="bulkAction"
                  value="skip"
                  confirm="Skip Robert's review for every selected project? They go straight to Spot check."
                >
                  Skip selected
                </ActionButton>
              </div>
              <TelescreenReviewTable makerLinks={access.isOwner}
                rows={awaiting}
                handles={handles}
                blackoutIds={blackoutIds}
                selectName="projectIds"
                emptyLabel="Nothing waiting on Robert right now."
              />
            </form>
          ) : (
            <TelescreenReviewTable makerLinks={access.isOwner}
              rows={awaiting}
              handles={handles}
              blackoutIds={blackoutIds}
              emptyLabel="Nothing waiting on Robert right now."
            />
          )}
        </Card>
      )}
      {rows.length === 0 && (
        <Card>
          <EmptyState title="No fraud reviews yet" icon="private" />
        </Card>
      )}
      {[...days.entries()].map(([key, dayRows]) => {
        const fraud = dayRows.filter((r) => r.robert_trust_score <= FRAUD_SCORE_THRESHOLD).length;
        return (
          <Card key={key} padding="flush">
            <CardHeader
              title={dayLabel(key)}
              icon="clock"
              count={dayRows.length}
              action={<Muted className="text-sm">{fraud} in the fraud range</Muted>}
            />
            <Table headers={["Project", "Score", "Robert's note", "In Pixl", "Credited"]}>
              {dayRows.map((p) => (
                <tr key={p.id} className="align-top">
                  <td>
                    <TextLink href={`/review/${p.id}`} className="font-bold">
                      {p.name}
                    </TextLink>
                    <div className="hc-caption mt-1 text-xs">
                      <Mono>#{p.id}</Mono> by {maker(p)}
                    </div>
                    <div className="hc-caption text-xs">{timeLabel(p.robert_reviewed_at)}</div>
                  </td>
                  <td>
                    <Badge tone={p.robert_trust_score <= FRAUD_SCORE_THRESHOLD ? "danger" : "neutral"}>
                      {p.robert_trust_score}/10
                    </Badge>
                  </td>
                  <td className="max-w-md whitespace-normal">
                    {p.robert_note || <Muted>No note given.</Muted>}
                  </td>
                  <td>{p.banned_at ? <Badge tone="danger">Banned</Badge> : <StatusBadge status={p.status} />}</td>
                  <td className="whitespace-nowrap">
                    <div>{fmtHours(p.approved_hours)}</div>
                    <Muted className="text-xs">
                      {fmtHours(p.hackatime_seconds == null ? null : p.hackatime_seconds / 3600)} tracked
                    </Muted>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
