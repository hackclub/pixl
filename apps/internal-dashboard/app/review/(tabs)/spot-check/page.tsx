import { redirect } from "next/navigation";
import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { listSpotCheckProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { Card, CardHeader } from "@/app/_ui/ui";
import { TelescreenReviewTable } from "../TelescreenReviewTable";

export const dynamic = "force-dynamic";

// Final-verdict queue (owners and final reviewers): projects Robert already reviewed as
// "not fraud" (see lib/robertSync.ts), waiting on the real approve & credit /
// request changes / ban decision. Each row's project page shows Robert's
// trust score and note alongside the full review form. Oldest first.
export default async function SpotCheckPage() {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  if (!access.isOwner && !access.canSecondPass) redirect("/review");

  const [rows, blackoutIds] = await Promise.all([
    // includeClaimed: a project another reviewer has open stays listed (tagged), like /review.
    listSpotCheckProjects(access.session.slackId, undefined, { includeClaimed: true }),
    listBlackoutQueueProjectIds(),
  ]);
  const handles = await slackHandles(rows.flatMap((p) => [p.users?.slack_id, p.claimedBy]));

  return (
    <div className="flex flex-col gap-6">
      <p className="hc-caption max-w-2xl text-sm">
        Projects a second-pass reviewer already triaged &quot;not fraud&quot;, waiting on your real verdict,
        oldest first. Open one to see their note and hours call before deciding.
      </p>
      <Card padding="flush">
        <CardHeader title="Spot check" icon="checkmark" count={rows.length} />
        <TelescreenReviewTable makerLinks={access.isOwner}
          rows={rows}
          handles={handles}
          blackoutIds={blackoutIds}
          emptyLabel="Nothing waiting on a spot check right now."
        />
      </Card>
    </div>
  );
}
