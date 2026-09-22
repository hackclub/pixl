import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listSecondReviewProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { hackatimeUserIdsFor } from "@/lib/hackatime";
import { listBlackoutQueueProjectIds } from "@/lib/operations";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

// A dedicated view of every project sitting in second_review (the final pass
// after fraud review), for anyone who can do that pass - supers, and anyone
// else granted the SECOND_PASS marker (e.g. a Sponsor, see addSponsor in
// app/actions.ts, which promises "review access, including the final pass").
// This used to be gated on isSuper alone, which silently locked non-super
// second-pass reviewers out of this tab even though they could already work
// the same queue via the main /review page's "Awaiting your final pass"
// section , that queue folds these into a section alongside everything else,
// easy to miss, this gives a plain list of just that stage across both kinds,
// oldest first.
export default async function SecondPassPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.canSecondPass) redirect("/review");

  const [rows, blackoutIds] = await Promise.all([
    listSecondReviewProjects(access.session.slackId),
    listBlackoutQueueProjectIds(),
  ]);
  const [handles, hackatimeUserIds] = await Promise.all([
    slackHandles(rows.map((p) => p.users?.slack_id)),
    hackatimeUserIdsFor(rows),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Second pass</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Projects that cleared fraud review and are waiting on a final approval, oldest first.
      </p>
      <ReviewTable
        rows={rows}
        handles={handles}
        hackatimeUserIds={hackatimeUserIds}
        blackoutIds={blackoutIds}
        emptyLabel="Nothing waiting on a final pass right now."
      />
    </div>
  );
}
