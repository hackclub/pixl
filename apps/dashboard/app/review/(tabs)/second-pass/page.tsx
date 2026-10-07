import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listSecondReviewProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { getHideReviewers } from "@/lib/liveModeServer";
import { hackatimeUserIdsFor } from "@/lib/hackatime";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

// A dedicated, read-only view of every project parked in fraud_review
// awaiting Robert's fraud review (see lib/robertSync.ts) - there's no human
// action to take here anymore (see 0206_robert_fraud_review.sql), this just
// lets anyone who used to do fraud triage - supers, and anyone else granted
// the SECOND_PASS marker (e.g. a Sponsor, see addSponsor in app/actions.ts,
// which promises "review access, including the final pass") - see what's
// still waiting on Robert and why (e.g. a stuck robert_error), oldest first.
export default async function SecondPassPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.canSecondPass) redirect("/review");

  const [rows, blackoutIds] = await Promise.all([
    // includeClaimed: a project another reviewer has open stays listed (tagged), like /review.
    listSecondReviewProjects(access.session.slackId, undefined, { includeClaimed: true }),
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
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Second pass</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Projects that passed a first review and are now awaiting Robert&apos;s fraud review , read-only,
        oldest first. They move on to Spot check automatically once Robert&apos;s score lands.
      </p>
      <ReviewTable
        rows={rows}
        handles={handles}
        hackatimeUserIds={hackatimeUserIds}
        blackoutIds={blackoutIds}
        emptyLabel="Nothing waiting on Robert right now."
      />
    </div>
  );
}
