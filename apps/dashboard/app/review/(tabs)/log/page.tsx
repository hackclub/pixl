import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listReviewAudits } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

// reviewProject (app/actions.ts) writes six distinct verdict strings via
// insertReviewAudit: "approved", "first_pass_approved", "needs_changes",
// "banned", "first_pass_banned", and "reverted" (from the separate revoke
// action). This used to only special-case "approved"/"reverted" and dumped
// everything else - including every first-pass approval proposal - into
// "sent back", which is why an approval note could show a red "sent back"
// badge. An unrecognized verdict falls back to its raw value instead of
// silently mislabeling it as "sent back" again.
const VERDICT_BADGE: Record<string, { label: string; variant: "success" | "info" | "destructive" }> = {
  approved: { label: "approved", variant: "success" },
  first_pass_approved: { label: "approved (1st pass)", variant: "success" },
  reverted: { label: "reverted", variant: "info" },
  needs_changes: { label: "sent back", variant: "destructive" },
  banned: { label: "banned", variant: "destructive" },
  first_pass_banned: { label: "ban proposed", variant: "destructive" },
};

export default async function ReviewLogPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");
  const log = await listReviewAudits();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-3">Review log</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Owners only , every verdict with whether the reviewer opened the repo and
        demo, how long they spent in each, and any hour adjustments.
      </p>
      <Card className="divide-y divide-border py-0">
        {log.length === 0 && (
          <div className="p-5 text-muted-foreground text-sm">No verdicts yet.</div>
        )}
        {log.map((r) => {
          const badge = VERDICT_BADGE[r.verdict] ?? { label: r.verdict, variant: "destructive" as const };
          return (
          <div key={r.id} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Badge variant={badge.variant} className="shrink-0">
              {badge.label}
            </Badge>
            <div className="flex-1 min-w-48">
              <span className="font-bold">{r.reviewer}</span>
              {" → "}
              <Link href={`/players/${r.user_id}`} className="font-bold hover:text-brand">
                {r.player_name}
              </Link>
              {" · "}
              <Link href={`/projects/${r.project_id}`} className="font-bold hover:text-brand">
                {r.project_name}
              </Link>
              <div className="text-foreground/70 break-words">{r.note}</div>
              {r.verdict !== "reverted" && (
                <div className="text-xs text-muted-foreground mt-1">
                  repo {r.repo_opened ? `✓ ${fmtSeconds(r.repo_seconds)}` : "✗ never opened"}
                  {" · "}
                  demo {r.demo_opened ? `✓ ${fmtSeconds(r.demo_seconds)}` : "✗ never opened"}
                  {" · "}
                  {fmtSeconds(r.total_seconds)} on review
                  {" · "}
                  {r.approved_hours !== null && r.approved_hours !== r.claimed_hours
                    ? `hours ${r.claimed_hours}h → ${r.approved_hours}h`
                    : `${r.claimed_hours}h credited as logged`}
                </div>
              )}
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
          );
        })}
      </Card>
    </div>
  );
}
