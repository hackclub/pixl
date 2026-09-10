import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listSpotCheckProjects } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { SpotCheckTable } from "@/app/_components/SpotCheckTable";

export const dynamic = "force-dynamic";

// Super-admin-only optional QA pass over the second_review stage - not an
// action queue. Marking one "Checked" (here or on its own review page) just
// dismisses it from this list for every super, it has no effect on the
// project itself; a real final reviewer still has to act on it separately.
// The point is spotting whether first-pass reviewers deflated hours,
// documented evidence, etc. well enough, not gating the ship.
export default async function SpotCheckPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");

  const rows = await listSpotCheckProjects();
  const handles = await slackHandles(rows.map((p) => p.users?.slack_id));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Spot check</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Projects that cleared a first pass and are waiting on final approval, oldest first.
        Optional , mark one checked once you&apos;ve looked at how the first-pass reviewer
        handled it (deflated hours, evidence, etc). It has no effect on the project; whoever
        gives the real second pass still needs to act on it separately.
      </p>
      <SpotCheckTable rows={rows} handles={handles} />
    </div>
  );
}
