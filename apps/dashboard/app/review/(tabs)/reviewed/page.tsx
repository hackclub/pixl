import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listReviewedProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { ReviewTable } from "@/app/_components/ReviewTable";

export const dynamic = "force-dynamic";

export default async function ReviewedPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  const rows = await listReviewedProjects();
  const handles = await slackHandles(rows.map((p) => p.users?.slack_id));

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-4">{rows.length} reviewed</div>
      <ReviewTable rows={rows} handles={handles} emptyLabel="No projects reviewed yet." />
    </div>
  );
}
