/* eslint-disable @next/next/no-img-element */
import { DoubleDipBanner } from "@/app/_components/DoubleDipBanner";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePage, can } from "@/lib/guard";
import { db, getProject, listCollaboratorsForProject, listProjectNotes } from "@/lib/db";
import { FRAUD_SCORE_THRESHOLD } from "@/lib/robertOutcome";
import { builderNameFor } from "@/lib/reviewAccess";
import { fetchCommits, type CommitResult } from "@/lib/commits";
import {
  reReviewProject,
  archiveProject,
  rejectProject,
  unrejectProject,
  banProject,
  unbanProject,
  toggleProjectPeak,
  sendProjectToAirtable,
  deflateProjectHours,
  extendHoursCutoff,
} from "@/app/actions";
import { hackatimeCutoffUnix, hackatimeCutoffLabel } from "@/app/_generated/config";
import { fetchAirtableRecord, JUSTIFICATION_DISPLAY_FIELDS } from "@/lib/airtable";
import { LevelBadge, BeaconBadge, ShipBadges } from "@/app/_components/ProjectBadges";
import { CommitList } from "@/app/_components/CommitList";
import { ProjectNotes } from "@/app/_components/ProjectNotes";
import { renderMarkdown } from "@/lib/markdown";
import { isSafeUrl } from "@/lib/safeUrl";
import { slackHandle } from "@/lib/slack";
import {
  ActionButton,
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  Details,
  EmptyState,
  Field,
  Flash,
  Input,
  Muted,
  PageHeader,
  Stat,
  StatGrid,
  StatusBadge,
  TextLink,
  Textarea,
  Timeline,
  formatDate,
  formatDateTime,
  type Tone,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

interface ReviewAuditRow {
  id: number;
  reviewer: string;
  verdict: string;
  note: string | null;
  audit_note: string | null;
  claimed_hours: number | null;
  approved_hours: number | null;
  total_seconds: number | null;
  created_at: string;
}

const AUDIT_VERDICT: Record<string, { label: string; tone: Tone }> = {
  first_pass_approved: { label: "First pass approved", tone: "neutral" },
  first_pass_banned: { label: "First pass proposed ban", tone: "danger" },
  approved: { label: "Approved", tone: "success" },
  needs_changes: { label: "Changes requested", tone: "danger" },
  banned: { label: "Banned", tone: "danger" },
  sent_to_first_pass: { label: "Sent to first pass", tone: "info" },
  reverted: { label: "Reverted", tone: "info" },
};

const HISTORY_ACTION: Record<string, { label: string; tone: Tone }> = {
  project_approved: { label: "Approved", tone: "success" },
  review_reverted: { label: "Reverted", tone: "info" },
  project_first_pass: { label: "First pass", tone: "neutral" },
  project_hours_deflated: { label: "Hours deflated", tone: "warning" },
  project_hours_raised: { label: "Hours raised", tone: "success" },
};

const DIVIDER = "mt-4 border-t border-[var(--border)] pt-4";

// Notes saved from some forms carry a literal backslash-r (a pasted CRLF that
// was escaped), which would show up as noise in the text.
function cleanNote(s: string | null): string {
  return (s ?? "").replace(/\\r\\n|\\r|\\n/g, "\n").replace(/\r/g, "").trim();
}

// The internal audit note is "SECTION HEADER:\ntext" blocks; set the headers
// (TECHNICAL FEATURES, DEFLATION REASON, NOTES, ...) apart, keep the text as-is.
function AuditNoteText({ text }: { text: string }) {
  const lines = cleanNote(text).split("\n");
  return (
    <div className="whitespace-pre-wrap break-words text-sm">
      {lines.map((line, i) =>
        /^[A-Z][A-Z ]+:$/.test(line.trim()) ? (
          <div key={i} className="hc-eyebrow mt-2 first:mt-0">
            {line.trim()}
          </div>
        ) : (
          <div key={i}>{line || " "}</div>
        ),
      )}
    </div>
  );
}

// GitHub, Slack and Airtable all stream in behind Suspense so a slow
// external service never holds the page.

async function OwnerHandleName({
  slackId,
  render,
}: {
  slackId: string | null | undefined;
  render: (handle: string | null) => string;
}) {
  return <>{render(await slackHandle(slackId))}</>;
}

async function CommitCount({ commits }: { commits: Promise<CommitResult> }) {
  const c = await commits;
  return <>{c.commits.length}{c.hasMore ? "+" : ""}</>;
}

async function Commits({ commits, projectId }: { commits: Promise<CommitResult>; projectId: number }) {
  return <CommitList result={await commits} projectId={projectId} />;
}

async function AirtableRecord({
  recordId,
  approvedHours,
}: {
  recordId: string;
  approvedHours: number | null;
}) {
  const airtable = await fetchAirtableRecord(recordId);
  if (!airtable.ok) return <Muted className="text-sm">Couldn&apos;t load: {airtable.error}</Muted>;
  const hoursOnAirtable = airtable.fields["Optional - Override Hours Spent"];
  const mismatch = typeof hoursOnAirtable === "number" && approvedHours !== null && hoursOnAirtable !== approvedHours;
  return (
    <div className="flex flex-col gap-3 text-sm">
      {typeof hoursOnAirtable === "number" &&
        (mismatch ? (
          <Callout tone="warning" icon="important">
            Hours on Airtable: {hoursOnAirtable}h. Pixl has {approvedHours}h, so they don&apos;t match.
          </Callout>
        ) : (
          <div className="font-bold">Hours on Airtable: {hoursOnAirtable}h</div>
        ))}
      {JUSTIFICATION_DISPLAY_FIELDS.filter((f) => f !== "Optional - Override Hours Spent").map((field) => {
        const value = airtable.fields[field];
        if (value === undefined || value === null || value === "") return null;
        return (
          <div key={field}>
            <div className="hc-eyebrow">{field}</div>
            <div className="whitespace-pre-wrap break-words">{String(value)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const access = await requirePage("reviewer");
  const { id } = await params;
  const { error } = await searchParams;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) notFound();
  const data = await getProject(projectId);
  if (!data) notFound();
  const { project, journals, verdicts } = data;
  // Reviewers' internal justifications and Robert's fraud review are staff
  // context, same audience as the review page, so they need review access.
  const canSeeReviews = can(access, "reviewer");
  const [notes, collaborators, audits] = await Promise.all([
    listProjectNotes(projectId),
    listCollaboratorsForProject(projectId),
    canSeeReviews
      ? db
          .from("review_audits")
          .select("id, reviewer, verdict, note, audit_note, claimed_hours, approved_hours, total_seconds, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .then((r) => (r.data ?? []) as ReviewAuditRow[])
      : Promise.resolve([] as ReviewAuditRow[]),
  ]);
  // Started now, awaited inside Suspense boundaries below.
  const commits = fetchCommits(project.repo_url);

  // The Trial this project was shipped for, if the player flagged one at ship
  // time (joined in getProject). null = they built their own idea.
  const trial = (
    project as {
      sidequests?: { name?: string; region?: string; reward?: string; min_hours?: number | null } | null;
    }
  ).sidequests;
  const journalHours = Math.round(journals.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 10) / 10;
  const hackatimeHours = Math.round(((project.hackatime_seconds ?? 0) / 3600) * 10) / 10;
  const totalHours = hackatimeHours > 0 ? hackatimeHours : journalHours;

  // Banning, archiving, rejecting and sending back are admin actions;
  // reviewers only grade. Owner-only.
  const canModerate = can(access, "owner");
  // Marking a project Beacon is a grading call, not moderation, so any
  // reviewer can do it, same as the initial verdict.
  const canPeak = can(access, "reviewer");
  const canReReview = canModerate && (project.status === "approved" || project.status === "needs_changes");
  // Deflating hours moves real pixels, can cancel a player's orders, and DMs
  // them, so owners only (see deflateProjectHours in app/actions.ts).
  const canDeflate = access.isOwner && project.status === "approved" && !project.banned_at && !project.rejected_at;
  // Mirrors the guard in extendHoursCutoff (app/actions.ts): allowed any time
  // before the project is finalized, and only once a Hackatime project is
  // linked, otherwise there's nothing to recount hours from.
  const canExtendCutoff =
    canPeak &&
    project.status !== "approved" &&
    project.status !== "rejected" &&
    !project.banned_at &&
    (project.hackatime_projects?.length ?? 0) > 0;
  // One day before the global cutoff, for the extend-hours date input's max.
  const maxExtendDateStr = new Date((hackatimeCutoffUnix - 86_400) * 1000).toISOString().slice(0, 10);

  const ownerName = (handle: string | null) =>
    project.users
      ? // Legal name for owners/final reviewers only.
        builderNameFor(access, project.users, { handle })
      : project.user_id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink href="/projects" variant="ghost" size="sm" icon="view-back">
          Projects
        </ButtonLink>
        <ButtonLink href={`/review/${project.id}`} variant="outline" size="sm">
          Open in review view
        </ButtonLink>
      </div>

      <div className="flex items-start gap-4">
        {project.image_url && isSafeUrl(project.image_url) && (
          <img
            src={project.image_url}
            alt=""
            className="hc-card h-20 w-20 shrink-0 object-cover md:h-24 md:w-24"
            data-density="flush"
          />
        )}
        <div className="min-w-0 flex-1">
          <PageHeader
            title={
              <>
                <span className="break-words">{project.name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={project.status} />
                  {project.is_peak && <BeaconBadge />}
                  <LevelBadge level={project.level} />
                  <ShipBadges project={project} />
                  {project.archived_at && <Badge>Archived</Badge>}
                  {project.rejected_at && <Badge tone="danger">Rejected</Badge>}
                  {project.banned_at && <Badge tone="danger">Banned</Badge>}
                </span>
              </>
            }
            description={
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  by{" "}
                  {project.users ? (
                    <TextLink href={`/players/${project.user_id}`} className="font-bold">
                      <Suspense fallback={ownerName(null)}>
                        <OwnerHandleName slackId={project.users.slack_id} render={ownerName} />
                      </Suspense>
                    </TextLink>
                  ) : (
                    project.user_id
                  )}
                </span>
                {collaborators.length > 0 && (
                  <span>
                    with{" "}
                    {collaborators.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        {c.users ? (
                          <TextLink href={`/players/${c.user_id}`} className="font-bold">
                            {builderNameFor(access, c.users)}
                          </TextLink>
                        ) : (
                          c.user_id
                        )}
                        {c.status === "pending" && " (invited)"}
                      </span>
                    ))}
                  </span>
                )}
                <span>created {formatDateTime(project.created_at)}</span>
                {project.shipped_at && <span>shipped {formatDateTime(project.shipped_at)}</span>}
              </span>
            }
          />
        </div>
      </div>

      {(error || project.rejected_at || project.banned_at || project.system_note || project.hours_deflated_at) && (
        <div className="flex flex-col gap-2">
          <Flash error={error} />
          {project.rejected_at && (
            <Callout tone="danger" icon="view-close">
              <div className="font-bold">Rejected{project.reject_by ? ` by ${project.reject_by}` : ""}</div>
              {project.reject_reason && <div className="mt-1 break-words">{project.reject_reason}</div>}
              <div className="mt-2 text-xs">
                The owner was told who rejected it, the reason, and to contact the Pixl team if it&apos;s a
                mistake.
              </div>
            </Callout>
          )}
          {project.banned_at && (
            <Callout tone="danger" icon="private">
              <div className="font-bold">Banned permanently{project.ban_by ? ` by ${project.ban_by}` : ""}</div>
              {project.ban_reason && <div className="mt-1 break-words">{project.ban_reason}</div>}
              <div className="mt-2 text-xs">
                This project can never be shipped again. The owner was told who banned it, the reason, and to
                contact the Pixl team.
              </div>
            </Callout>
          )}
          <DoubleDipBanner systemNote={project.system_note} />
          {project.hours_deflated_at && (
            <Callout tone="warning" icon="important">
              <div className="font-bold">
                Hours deflated{project.hours_deflated_by ? ` by ${project.hours_deflated_by}` : ""} on{" "}
                {formatDateTime(project.hours_deflated_at)}
              </div>
              {project.deflation_reason && <div className="mt-1 break-words">{project.deflation_reason}</div>}
            </Callout>
          )}
        </div>
      )}

      <StatGrid>
        <Stat
          label={hackatimeHours > 0 ? "Hackatime hours" : "Logged hours"}
          value={`${totalHours}h`}
          icon="clock"
          hint={project.approved_hours !== null ? `${project.approved_hours}h credited` : undefined}
        />
        <Stat label="Journal entries" value={journals.length} icon="docs" />
        <Stat
          label="Recent commits"
          value={
            <Suspense fallback={<Muted>...</Muted>}>
              <CommitCount commits={commits} />
            </Suspense>
          }
          icon="github"
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="About" icon="info" />
            {project.description ? (
              <p className="break-words text-sm">{project.description}</p>
            ) : (
              <Muted className="text-sm">No description.</Muted>
            )}
            {project.is_update && project.update_notes && (
              <div className="hc-panel mt-3 text-sm">
                <div className="hc-eyebrow">What changed since last approval</div>
                <div className="mt-1 whitespace-pre-wrap break-words">{project.update_notes}</div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {isSafeUrl(project.repo_url) && (
                <ButtonLink href={project.repo_url} external variant="outline" size="sm" icon="github">
                  Repo
                </ButtonLink>
              )}
              {isSafeUrl(project.demo_url) && (
                <ButtonLink href={project.demo_url} external variant="outline" size="sm" icon="external">
                  Demo
                </ButtonLink>
              )}
              {!isSafeUrl(project.repo_url) && !isSafeUrl(project.demo_url) && (
                <Muted className="text-sm">No links yet.</Muted>
              )}
            </div>
            {trial?.name && (
              <div className="mt-3">
                <Badge tone="purple">
                  Trial: {trial.name}
                  {trial.region ? `, ${trial.region}` : ""}
                  {trial.reward ? `, reward: ${trial.reward}` : ""}
                  {trial.min_hours != null ? `, min ${trial.min_hours}h` : ""}
                </Badge>
              </div>
            )}
            {project.hackatime_projects?.length > 0 && (
              <p className="mt-3 text-xs hc-muted">Hackatime: {project.hackatime_projects.join(", ")}</p>
            )}
            {project.review_note && (
              <div className="hc-panel mt-4 text-sm">
                <div className="hc-eyebrow">
                  Reviewer note{project.review_note_by ? `, by ${project.review_note_by}` : ""}
                </div>
                <div className="mt-1 break-words">{project.review_note}</div>
              </div>
            )}
          </Card>

          <Card padding="flush">
            <CardHeader title="Commits" icon="github" />
            <Suspense fallback={<EmptyState title="Loading commits..." icon="github" />}>
              <Commits commits={commits} projectId={project.id} />
            </Suspense>
          </Card>

          <Card padding="flush">
            <CardHeader title="Journal" icon="docs" count={journals.length} />
            {journals.length === 0 ? (
              <EmptyState title="No journal entries yet" icon="docs" />
            ) : (
              <ul>
                {journals.map((j) => (
                  <li key={j.id} className="border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="info">{Math.round((Number(j.hours) || 0) * 10) / 10}h</Badge>
                        {j.title && <span className="font-bold">{j.title}</span>}
                      </div>
                      <Muted className="text-xs">
                        {formatDateTime(j.created_at)}
                        {j.edited_at && `, edited ${formatDateTime(j.edited_at)}`}
                      </Muted>
                    </div>
                    <div
                      className="hc-markdown break-words text-sm"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(j.content) }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ProjectNotes projectId={project.id} notes={notes} />

          {canSeeReviews && access.canFraudReview && (project.robert_project_id || project.robert_trust_score != null) && (
            <Card>
              <CardHeader title="Robert fraud review" icon="search-magic" />
              {project.robert_trust_score != null ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Badge tone={project.robert_trust_score <= FRAUD_SCORE_THRESHOLD ? "danger" : "neutral"}>
                      {project.robert_trust_score}/10
                    </Badge>
                    {project.robert_trust_score <= FRAUD_SCORE_THRESHOLD && (
                      <span className="font-bold" style={{ color: "var(--hc-red)" }}>
                        Robert&apos;s &quot;Fraud&quot; range
                      </span>
                    )}
                    {project.robert_state && <Muted className="text-xs">Robert state: {project.robert_state}</Muted>}
                    {project.robert_reviewed_at && (
                      <Muted className="text-xs">reviewed {formatDateTime(project.robert_reviewed_at)}</Muted>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm">
                    {project.robert_note || "No note given."}
                  </div>
                  {project.robert_outcome && (
                    <Muted className="text-xs">
                      Pixl&apos;s final verdict was sent back to Robert: {project.robert_outcome}
                      {project.robert_outcome_at ? ` (${formatDateTime(project.robert_outcome_at)})` : ""}
                    </Muted>
                  )}
                </div>
              ) : (
                <div className="text-sm">
                  <Muted>
                    {project.robert_submitted_at
                      ? `Submitted to Robert ${formatDateTime(project.robert_submitted_at)}, no review yet.`
                      : "Not submitted to Robert yet."}
                  </Muted>
                  {project.robert_error && (
                    <div className="mt-2">
                      <Callout tone="danger">Last submission failed: {project.robert_error}</Callout>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {canSeeReviews && (
            <Card padding="flush">
              <CardHeader title="Review justifications" icon="clipboard-text" count={audits.length} />
              {audits.length === 0 ? (
                <EmptyState title="No review justifications recorded yet" icon="clipboard-text" />
              ) : (
                <ul>
                  {audits.map((a) => {
                    const verdict = AUDIT_VERDICT[a.verdict] ?? {
                      label: a.verdict.replace(/_/g, " "),
                      tone: "danger" as Tone,
                    };
                    return (
                      <li
                        key={a.id}
                        className="flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <Badge tone={verdict.tone}>{verdict.label}</Badge>
                          <span className="font-bold">{a.reviewer}</span>
                          {a.claimed_hours != null && (
                            <Muted className="text-xs">
                              {a.claimed_hours}h claimed
                              {a.approved_hours != null && a.approved_hours !== a.claimed_hours
                                ? `, ${a.approved_hours}h credited`
                                : a.approved_hours != null
                                  ? ", credited in full"
                                  : ""}
                            </Muted>
                          )}
                          {a.total_seconds != null && a.total_seconds > 0 && (
                            <Muted className="text-xs">
                              {Math.floor(a.total_seconds / 60)}m {a.total_seconds % 60}s on the review
                            </Muted>
                          )}
                          <Muted className="ml-auto text-xs">{formatDateTime(a.created_at)}</Muted>
                        </div>
                        {a.audit_note && cleanNote(a.audit_note) && <AuditNoteText text={a.audit_note} />}
                        {a.note && cleanNote(a.note) && (
                          <div className="hc-panel whitespace-pre-wrap break-words text-sm">
                            <div className="hc-eyebrow">Note to player</div>
                            {cleanNote(a.note)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Review history" icon="history" count={verdicts.length} />
            <Timeline
              empty="Not reviewed yet"
              entries={verdicts.map((v) => {
                const action = HISTORY_ACTION[v.action] ?? { label: "Sent back", tone: "danger" as Tone };
                return {
                  key: v.id,
                  title: (
                    <>
                      <Badge tone={action.tone}>{action.label}</Badge>
                      <span className="font-bold">{v.actor}</span>
                    </>
                  ),
                  meta: formatDateTime(v.created_at),
                  body: v.detail ? <div className="break-words text-sm">{v.detail}</div> : undefined,
                };
              })}
            />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {canPeak && (
            <Card>
              <CardHeader title="Beacon" icon="rep" />
              <p className="hc-caption mb-3 text-sm">
                Nominate a standout project. Purely cosmetic: shown wherever this project is displayed publicly,
                never a payout change.
              </p>
              <form action={toggleProjectPeak}>
                <input type="hidden" name="projectId" value={project.id} />
                {!project.is_peak && <input type="hidden" name="isPeak" value="1" />}
                <ActionButton
                  variant={project.is_peak ? "outline" : "cream"}
                  size="sm"
                  icon={project.is_peak ? undefined : "rep"}
                  pendingLabel={project.is_peak ? "Removing..." : "Marking..."}
                >
                  {project.is_peak ? "Remove Beacon" : "Mark as Beacon"}
                </ActionButton>
              </form>
            </Card>
          )}

          {(project.hours_extended_since || canExtendCutoff) && (
            <Card>
              <CardHeader title="Hours cutoff" icon="clock" />
              {project.hours_extended_since && (
                <p className="mb-3 text-sm">
                  Counting hours from <span className="font-bold">{formatDate(project.hours_extended_since)}</span>{" "}
                  (before the {hackatimeCutoffLabel} cutoff), set by{" "}
                  <span className="font-bold">{project.hours_extended_by}</span>: {project.hours_extended_note}
                </p>
              )}
              {canExtendCutoff && (
                <Details summary="Extend hours cutoff">
                  <p className="hc-caption mb-3 text-xs">
                    Normally only hours from {hackatimeCutoffLabel} onward count. If this project genuinely started
                    earlier and paused, pick how far back to count from. This re-pulls their Hackatime spans and
                    raises the credited total, it never lowers it.
                  </p>
                  <form action={extendHoursCutoff} className="flex flex-col gap-3">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="returnTo" value={`/projects/${project.id}`} />
                    <Field label="Count from">
                      <Input
                        type="date"
                        name="since"
                        required
                        max={maxExtendDateStr}
                        defaultValue={
                          project.hours_extended_since
                            ? new Date(project.hours_extended_since).toISOString().slice(0, 10)
                            : undefined
                        }
                      />
                    </Field>
                    <Field label="Why" hint="The player sees this in a DM.">
                      <Textarea name="note" required rows={2} placeholder="Why count from this date" />
                    </Field>
                    <div>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        pendingLabel="Extending..."
                        confirm="Recount this project's hours from that date? This only ever raises the credited total, and the owner is notified."
                      >
                        Extend cutoff
                      </ActionButton>
                    </div>
                  </form>
                </Details>
              )}
            </Card>
          )}

          {canModerate && (
            <Card>
              <CardHeader title="Staff actions" icon="admin-badge" />
              <p className="hc-caption mb-3 text-sm">
                Everything here is reversible and kept in history. Nothing is erased.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {canReReview && (
                  <form action={reReviewProject}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <ActionButton size="sm" icon="view-reload" pendingLabel="Sending...">
                      Send back to review
                    </ActionButton>
                  </form>
                )}
                <form action={archiveProject}>
                  <input type="hidden" name="projectId" value={project.id} />
                  {project.archived_at && <input type="hidden" name="unarchive" value="1" />}
                  <ActionButton
                    variant="outline"
                    size="sm"
                    pendingLabel={project.archived_at ? "Unarchiving..." : "Archiving..."}
                  >
                    {project.archived_at ? "Unarchive" : "Archive"}
                  </ActionButton>
                </form>
                {project.rejected_at && (
                  <form action={unrejectProject}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <ActionButton variant="success" size="sm" pendingLabel="Restoring...">
                      Restore (un-reject)
                    </ActionButton>
                  </form>
                )}
                {project.banned_at && (
                  <form action={unbanProject}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <ActionButton variant="success" size="sm" pendingLabel="Lifting...">
                      Lift ban
                    </ActionButton>
                  </form>
                )}
                {project.status === "approved" && !project.banned_at && !project.rejected_at && (
                  <form action={sendProjectToAirtable}>
                    <input type="hidden" name="projectId" value={project.id} />
                    <ActionButton variant="outline" size="sm" pendingLabel="Sending...">
                      {project.airtable_record_id ? "Re-send to Airtable" : "Send to Airtable"}
                    </ActionButton>
                  </form>
                )}
              </div>

              {!project.rejected_at && (
                <div className={DIVIDER}>
                  <h3 className="hc-heading text-sm">Reject project</h3>
                  <p className="hc-caption mb-2 mt-1 text-xs">
                    Removes this project from Pixl and tells the owner who rejected it and why. Reversible. This is
                    not a player ban, ban the player from their{" "}
                    <TextLink href={`/players/${project.user_id}`}>player page</TextLink>.
                  </p>
                  <form action={rejectProject} className="flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <Input name="reason" required placeholder="Reason (shown to the owner)" />
                    <div>
                      <ActionButton
                        variant="danger"
                        size="sm"
                        pendingLabel="Rejecting..."
                        confirm="Reject this project? The owner is told who rejected it and why."
                      >
                        Reject project
                      </ActionButton>
                    </div>
                  </form>
                </div>
              )}

              {!project.banned_at && (
                <div className={DIVIDER}>
                  <h3 className="hc-heading text-sm">Ban project (permanent)</h3>
                  <p className="hc-caption mb-2 mt-1 text-xs">
                    Permanently bans this project: it can never be shipped again and is hidden everywhere.
                    Different from a reject. Reversible by staff.
                  </p>
                  <form action={banProject} className="flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <Input name="reason" required placeholder="Reason for the ban (shown to the owner)" />
                    <div>
                      <ActionButton
                        variant="danger"
                        size="sm"
                        icon="private"
                        pendingLabel="Banning..."
                        confirm="Permanently ban this project? It can never be shipped again."
                      >
                        Ban project
                      </ActionButton>
                    </div>
                  </form>
                </div>
              )}

              {canDeflate && (
                <div className={DIVIDER}>
                  <h3 className="hc-heading text-sm">Correct approved hours</h3>
                  <p className="hc-caption mb-2 mt-1 text-xs">
                    Changes credited hours after approval, up or down, e.g. when Hack Club HQ flagged an
                    over-claim in Airtable or a spot check found more work. Fill in the new hours only for the
                    people who should change, a blank box leaves that person alone. Lowering claws their pixels
                    back down to what the new hours are worth and cancels any pending order that can no longer be
                    covered. Raising credits the difference. Either way it DMs them your reason.
                  </p>
                  <form action={deflateProjectHours} className="flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <Input name="hours_owner" type="number" step="0.1" min="0" placeholder="New hours" className="w-32" />
                        <span>
                          {project.users ? ownerName(null) : project.user_id}
                          <span className="hc-caption"> (owner, now {project.approved_hours ?? totalHours}h)</span>
                        </span>
                      </label>
                      {collaborators
                        .filter((c) => c.status === "accepted" && Number(c.approved_hours) > 0)
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
                            <Input name={`hours_${c.id}`} type="number" step="0.1" min="0" placeholder="New hours" className="w-32" />
                            <span>
                              {c.users ? builderNameFor(access, c.users) : c.user_id}
                              <span className="hc-caption"> (collaborator, now {Number(c.approved_hours)}h)</span>
                            </span>
                          </label>
                        ))}
                    </div>
                    <Textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Reason (shown to the owner, and any affected collaborators)"
                    />
                    <div>
                      <ActionButton
                        variant="danger"
                        size="sm"
                        pendingLabel="Saving..."
                        confirm="Change this project's hours? This immediately adjusts pixels (lowering claws back and may cancel pending orders, raising credits the difference) for the people you filled in, and DMs them why."
                      >
                        Change hours
                      </ActionButton>
                    </div>
                  </form>
                </div>
              )}
            </Card>
          )}

          {project.airtable_record_id && (
            <Card>
              <CardHeader title="Airtable record" icon="grid" />
              <Suspense fallback={<Muted className="text-sm">Loading from Airtable...</Muted>}>
                <AirtableRecord recordId={project.airtable_record_id} approvedHours={project.approved_hours} />
              </Suspense>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
