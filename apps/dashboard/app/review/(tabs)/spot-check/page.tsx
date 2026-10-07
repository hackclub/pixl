import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listSpotCheckProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { getHideReviewers } from "@/lib/liveModeServer";
import { hackatimeUserIdsFor } from "@/lib/hackatime";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

// Super-admin-only final-verdict queue: projects Robert already reviewed as
// "not fraud" (see lib/robertSync.ts), waiting on the real approve & credit /
// request changes / ban decision - each row's project page shows Robert's
// trust score and note alongside the full review form. Used to be a
// read-only QA audit over every second_review project; now that spot check
// IS the final verdict step, it's an action queue, oldest-first.
export default async function SpotCheckPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");

  const [rows, blackoutIds] = await Promise.all([
    // includeClaimed: a project another reviewer has open stays listed (tagged), like /review.
    listSpotCheckProjects(access.session.slackId, undefined, { includeClaimed: true }),
    listBlackoutQueueProjectIds(),
  ]);
  // While live (names not revealed), another reviewer's claim isn't resolved to a handle.
  const hideReviewers = await getHideReviewers();
  const [handles, hackatimeUserIds] = await Promise.all([
    slackHandles(rows.flatMap((p) => [
        p.users?.slack_id,
        hideReviewers && p.claimedBy !== access.session.slackId ? null : p.claimedBy,
      ])),
    hackatimeUserIdsFor(rows),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Spot check</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Projects a second-pass reviewer already triaged "not fraud" and are waiting on your real
        verdict, oldest first. Open one to see their note and hours call before deciding.
      </p>
      <ReviewTable
        rows={rows}
        handles={handles}
        hackatimeUserIds={hackatimeUserIds}
        blackoutIds={blackoutIds}
        emptyLabel="Nothing waiting on a spot check right now."
      />
    </div>
  );
}
