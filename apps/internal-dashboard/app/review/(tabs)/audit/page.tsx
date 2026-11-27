import { redirect } from "next/navigation";
import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { canSeeBuilderPII } from "@/lib/reviewAccess";
import { db, listReviewAudits, type ReviewAuditRow } from "@/lib/db";
import { parseAuditNote, type AuditHeader } from "@/lib/auditNote";
import { slackIdFromLabel } from "@/lib/reviewStats";
import {
  parseAuditSort,
  parseSortDir,
  sortAudits,
  summarizeAudits,
  type AuditSortKey,
} from "@/lib/auditReviewerView";
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  EmptyState,
  Field,
  Muted,
  NativeSelect,
  Table,
  TextLink,
  formatDateTime,
  type Tone,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

// Friendly labels for the structured audit-note sections (see buildAuditNote
// in lib/auditNote.ts). "NOTES" is the reviewer's freeform "Additional notes"
// field from the review form, shown as its own block.
const SECTION_LABEL: Record<AuditHeader, string> = {
  "TECHNICAL FEATURES": "Technical features",
  "DEFLATION REASON": "Deflation reason",
  "AGE JUSTIFICATION": "Age justification",
  NOTES: "Additional notes",
};

const VERDICT_TONE: Record<string, Tone> = {
  approved: "success",
  first_pass_approved: "neutral",
  needs_changes: "warning",
  reverted: "danger",
  banned: "danger",
  first_pass_banned: "danger",
};

const SORT_LABEL: Record<AuditSortKey, string> = {
  date: "Date",
  hours: "Approved hours",
  claimed: "Claimed hours",
  time: "Time spent reviewing",
  project: "Project name",
  verdict: "Verdict",
};

const SLACK_ID_RE = /^[UW][A-Z0-9]{5,20}$/;

function reviewerName(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

function hoursLabel(value: number | string | null): string {
  if (value == null) return "n/a";
  const n = Number(value);
  return Number.isFinite(n) ? `${Math.round(n * 100) / 100}h` : "n/a";
}

// Every reviewer who ever wrote an audit, one entry per Slack id.
async function listAuditReviewers(): Promise<{ slackId: string; name: string; reviews: number }[]> {
  const { data, error } = await db.from("review_audits").select("reviewer").limit(50000);
  if (error) {
    console.error("listAuditReviewers", error.message);
    return [];
  }
  const byId = new Map<string, { slackId: string; name: string; reviews: number }>();
  for (const r of (data ?? []) as { reviewer: string }[]) {
    const slackId = slackIdFromLabel(r.reviewer ?? "");
    if (!slackId) continue;
    const entry = byId.get(slackId);
    if (entry) entry.reviews++;
    else byId.set(slackId, { slackId, name: reviewerName(r.reviewer), reviews: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function AuditCard({ a }: { a: ReviewAuditRow }) {
  const sections = parseAuditNote(a.audit_note);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <TextLink href={`/projects/${a.project_id}`} className="font-bold">
          {a.project_name}
        </TextLink>
        <Badge tone={VERDICT_TONE[a.verdict] ?? "neutral"}>{a.verdict.replaceAll("_", " ")}</Badge>
        <Muted className="text-xs">
          by {reviewerName(a.reviewer)}, player <TextLink href={`/players/${a.user_id}`}>{a.player_name}</TextLink>
        </Muted>
        <Muted className="ml-auto text-xs">{formatDateTime(a.created_at)}</Muted>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {(Object.keys(SECTION_LABEL) as AuditHeader[])
          .filter((h) => sections[h]?.trim())
          .map((h) => (
            <div key={h}>
              <div className="hc-eyebrow">{SECTION_LABEL[h]}</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{sections[h]}</p>
            </div>
          ))}
        {a.note?.trim() && (
          <div>
            <div className="hc-eyebrow">Note to player</div>
            <p className="mt-1 text-sm whitespace-pre-wrap">{a.note}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export default async function AuditNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ reviewer?: string; sort?: string; dir?: string }>;
}) {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  if (!access.isOwner) redirect("/review");

  const params = await searchParams;
  const sort = parseAuditSort(params.sort);
  const dir = parseSortDir(params.dir);
  const reviewers = await listAuditReviewers();
  // Only a Slack id that actually appears in review_audits is accepted.
  const selected = SLACK_ID_RE.test(params.reviewer ?? "")
    ? (reviewers.find((r) => r.slackId === params.reviewer) ?? null)
    : null;

  // Legal names only for owners/final reviewers.
  const realNames = canSeeBuilderPII(access);
  const audits = selected
    ? (await listReviewAudits(100000, selected.slackId, { realNames })).filter(
        (a) => slackIdFromLabel(a.reviewer) === selected.slackId,
      )
    : await listReviewAudits(200, undefined, { realNames });
  const sorted = selected ? sortAudits(audits, sort, dir) : audits;
  const withNotes = sorted.filter((a) => a.audit_note && a.audit_note.trim() !== "");
  const summary = selected ? summarizeAudits(audits) : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="hc-caption max-w-2xl text-sm">
        Internal notes reviewers write with every verdict. Players never see these: they&apos;re for audits
        and fraud checks. Pick a reviewer to see every review they made.
      </p>

      <form className="flex flex-wrap items-end gap-3">
        <Field label="Reviewer">
          <NativeSelect name="reviewer" defaultValue={selected?.slackId ?? ""}>
            <option value="">Everyone (latest 200)</option>
            {reviewers.map((r) => (
              <option key={r.slackId} value={r.slackId}>
                {r.name} ({r.reviews})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Sort by">
          <NativeSelect name="sort" defaultValue={sort}>
            {(Object.keys(SORT_LABEL) as AuditSortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Order">
          <NativeSelect name="dir" defaultValue={dir}>
            <option value="desc">Highest / newest first</option>
            <option value="asc">Lowest / oldest first</option>
          </NativeSelect>
        </Field>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      {selected && summary && (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="font-bold">{selected.name}</span>
              <Muted className="text-sm">{summary.reviews} reviews</Muted>
              <Muted className="text-sm">{hoursLabel(summary.approvedHours)} approved</Muted>
              <Muted className="text-sm">{hoursLabel(summary.claimedHours)} claimed</Muted>
              {Object.entries(summary.byVerdict).map(([v, n]) => (
                <Badge key={v} tone={VERDICT_TONE[v] ?? "neutral"}>
                  {v.replaceAll("_", " ")}: {n}
                </Badge>
              ))}
            </div>
          </Card>
          <Table headers={["Date", "Project", "Player", "Verdict", "Claimed", "Approved", "Review time", "Note"]}>
            {sorted.length === 0 ? (
              <EmptyRow colSpan={8} title="No reviews" />
            ) : (
              sorted.map((a) => (
                <tr key={a.id}>
                  <td>{formatDateTime(a.created_at)}</td>
                  <td>
                    <TextLink href={`/projects/${a.project_id}`}>{a.project_name}</TextLink>
                  </td>
                  <td>
                    <TextLink href={`/players/${a.user_id}`}>{a.player_name}</TextLink>
                  </td>
                  <td>
                    <Badge tone={VERDICT_TONE[a.verdict] ?? "neutral"}>{a.verdict.replaceAll("_", " ")}</Badge>
                  </td>
                  <td>{hoursLabel(a.claimed_hours)}</td>
                  <td>{hoursLabel(a.approved_hours)}</td>
                  <td>{Math.round(Number(a.total_seconds) / 60)} min</td>
                  <td>{a.audit_note?.trim() ? "yes" : "no"}</td>
                </tr>
              ))
            )}
          </Table>
        </>
      )}

      {withNotes.length === 0 ? (
        <Card>
          <EmptyState title="No audit notes yet" icon="docs">
            They&apos;ll appear as reviews come in.
          </EmptyState>
        </Card>
      ) : (
        withNotes.map((a) => <AuditCard key={a.id} a={a} />)
      )}
    </div>
  );
}
