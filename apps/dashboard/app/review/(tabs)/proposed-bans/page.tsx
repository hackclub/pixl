import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listProposedBanProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

// Super-admin-only view of projects where a first-pass reviewer's verdict was
// "ban" - reviewProject's first-pass branch never bans outright, it parks the
// project in second_review with first_pass_verdict='banned' for a different,
// final reviewer to confirm or overturn (same as any other second-pass
// decision). This just makes those easy to find instead of scrolling the
// general second-pass queue for one - the actual confirm/overturn still
// happens on the project's own review page, with the same required
// audit-note fields as any other second-pass verdict.
export default async function ProposedBansPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");

  const rows = await listProposedBanProjects();
  const handles = await slackHandles(rows.map((p) => p.users?.slack_id));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Proposed bans</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Projects a first-pass reviewer proposed banning, waiting on a final reviewer to confirm or
        overturn it, oldest first. Open one to decide , confirming or overturning still needs the
        same audit notes as any other second-pass verdict.
      </p>
      <ReviewTable
        rows={rows}
        handles={handles}
        emptyLabel="Nothing waiting on a ban decision right now."
      />
    </div>
  );
}
