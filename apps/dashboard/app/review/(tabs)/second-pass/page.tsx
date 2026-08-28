import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listSecondReviewProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

// A dedicated, super-admin-only view of every project sitting in second_review
// (the final pass after fraud review). The main /review queue folds these
// into an "Awaiting your final pass" section alongside everything else, which
// is easy to miss , this gives supers a plain list of just that stage across
// both kinds, oldest first.
export default async function SecondPassPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");

  const rows = await listSecondReviewProjects(access.session.slackId);
  const handles = await slackHandles(rows.map((p) => p.users?.slack_id));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Second pass</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Projects that cleared fraud review and are waiting on a final approval, oldest first.
      </p>
      <ReviewTable
        rows={rows}
        handles={handles}
        emptyLabel="Nothing waiting on a final pass right now."
      />
    </div>
  );
}
