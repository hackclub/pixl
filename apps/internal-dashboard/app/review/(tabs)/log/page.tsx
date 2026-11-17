import { redirect } from "next/navigation";
import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { canSeeBuilderPII } from "@/lib/reviewAccess";
import { staffName } from "@/lib/staffName";
import { listReviewAudits } from "@/lib/db";
import { Badge, Card, CardHeader, EmptyRow, Muted, Table, TextLink, formatDateTime, type Tone } from "@/app/_ui/ui";

import { reviewerPlayerId, reviewerPlayerIds } from "../reviewerLinks";

export const dynamic = "force-dynamic";

function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

// reviewProject (app/actions.ts) writes six distinct verdict strings via
// insertReviewAudit, plus "reverted" from the separate revoke action. Each
// gets its own label so a first-pass approval never reads as "sent back"; an
// unrecognized verdict falls back to its raw value.
const VERDICT_BADGE: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "approved", tone: "success" },
  first_pass_approved: { label: "approved (1st pass)", tone: "success" },
  reverted: { label: "reverted", tone: "info" },
  needs_changes: { label: "sent back", tone: "danger" },
  banned: { label: "banned", tone: "danger" },
  first_pass_banned: { label: "ban proposed", tone: "danger" },
  first_pass_removed: { label: "1st pass removed", tone: "warning" },
};

export default async function ReviewLogPage() {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  if (!access.isOwner) redirect("/review");
  // Legal names only for owners/final reviewers.
  const log = await listReviewAudits(undefined, undefined, { realNames: canSeeBuilderPII(access) });
  const reviewerIds = await reviewerPlayerIds(log.map((r) => r.reviewer));

  return (
    <div className="flex flex-col gap-6">
      <p className="hc-caption max-w-2xl text-sm">
        Owners only. Every verdict with whether the reviewer opened the repo and demo, how long they spent
        in each, and any hour adjustments.
      </p>
      <Card padding="flush">
        <CardHeader title="Reviewer log" icon="history" count={log.length} />
        <Table headers={["Verdict", "Reviewer", "Project", "Checks", "When"]}>
          {log.map((r) => {
            const badge = VERDICT_BADGE[r.verdict] ?? { label: r.verdict, tone: "danger" as const };
            const reviewer = staffName(r.reviewer);
            const reviewerId = reviewerPlayerId(reviewerIds, r.reviewer);
            return (
              <tr key={r.id} className="align-top">
                <td>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </td>
                <td className="whitespace-nowrap font-bold">
                  {reviewerId ? <TextLink href={`/players/${reviewerId}`}>{reviewer}</TextLink> : reviewer}
                </td>
                <td className="w-full min-w-64 whitespace-normal">
                  <TextLink href={`/projects/${r.project_id}`} className="font-bold">
                    {r.project_name}
                  </TextLink>
                  <div className="hc-caption text-xs">
                    by{" "}
                    <TextLink href={`/players/${r.user_id}`}>{r.player_name}</TextLink>
                  </div>
                  {r.note && <div className="mt-1 break-words">{r.note}</div>}
                </td>
                <td className="hc-caption whitespace-nowrap text-xs">
                  {r.verdict !== "reverted" && (
                    <div className="flex flex-col gap-0.5">
                      <span>repo {r.repo_opened ? `opened, ${fmtSeconds(r.repo_seconds)}` : "never opened"}</span>
                      <span>demo {r.demo_opened ? `opened, ${fmtSeconds(r.demo_seconds)}` : "never opened"}</span>
                      <span>{fmtSeconds(r.total_seconds)} on review</span>
                      <span>
                        {r.approved_hours !== null && r.approved_hours !== r.claimed_hours
                          ? `hours ${r.claimed_hours}h to ${r.approved_hours}h`
                          : `${r.claimed_hours}h credited as logged`}
                      </span>
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  <Muted>{formatDateTime(r.created_at)}</Muted>
                </td>
              </tr>
            );
          })}
          {log.length === 0 && <EmptyRow colSpan={5} title="No verdicts yet" icon="history" />}
        </Table>
      </Card>
    </div>
  );
}
