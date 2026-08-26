import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { listReviewAudits, countPendingReviews } from "@/lib/db";
import { parseAuditNote, type AuditHeader } from "@/lib/auditNote";
import { ReviewTabs } from "@/app/_components/ReviewTabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Friendly labels for the structured audit-note sections (see buildAuditNote
// in lib/auditNote.ts). "NOTES" is the reviewer's freeform "Additional notes"
// field from the review form - shown here as its own block instead of buried
// in one undifferentiated paragraph.
const SECTION_LABEL: Record<AuditHeader, string> = {
  "TECHNICAL FEATURES": "Technical features",
  "HACKATIME EVIDENCE": "Hackatime evidence",
  "DEFLATION REASON": "Deflation reason",
  "AGE JUSTIFICATION": "Age justification",
  NOTES: "Additional notes",
};

const VERDICT_VARIANT: Record<
  string,
  "success" | "secondary" | "warning" | "destructive"
> = {
  approved: "success",
  first_pass_approved: "secondary",
  needs_changes: "warning",
  reverted: "destructive",
  banned: "destructive",
  first_pass_banned: "destructive",
};

export default async function AuditNotesPage() {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  if (!access.isSuper) redirect("/review");
  const [audits, pending] = await Promise.all([listReviewAudits(200), countPendingReviews()]);
  const withNotes = audits.filter((a) => a.audit_note && a.audit_note.trim() !== "");

  return (
    <div>
      <ReviewTabs isSuper={access.isSuper} pending={pending} />
      <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
        Internal notes reviewers write with every verdict. Players never see these , they&apos;re
        for audits and fraud checks.
      </p>
      {withNotes.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          No audit notes yet , they&apos;ll appear as reviews come in.
        </Card>
      ) : (
        <div className="space-y-4">
          {withNotes.map((a) => {
            const sections = parseAuditNote(a.audit_note);
            return (
              <Card key={a.id} className="p-5 gap-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/projects/${a.project_id}`}
                    className="font-semibold hover:text-brand"
                  >
                    {a.project_name}
                  </Link>
                  <Badge variant={VERDICT_VARIANT[a.verdict] ?? "secondary"}>
                    {a.verdict.replaceAll("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    by {a.reviewer.replace(/\s*\([^)]*\)\s*$/, "")} · player{" "}
                    <Link href={`/players/${a.user_id}`} className="hover:text-brand">
                      {a.player_name}
                    </Link>
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-3 space-y-3">
                  {(Object.keys(SECTION_LABEL) as AuditHeader[])
                    .filter((h) => sections[h]?.trim())
                    .map((h) => (
                      <div key={h}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {SECTION_LABEL[h]}
                        </div>
                        <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap">
                          {sections[h]}
                        </p>
                      </div>
                    ))}
                  {a.note?.trim() && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Note to player
                      </div>
                      <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap">
                        {a.note}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
