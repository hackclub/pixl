import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePerm, canView } from "@/lib/guard";
import { getProject, listCollaboratorsForProject, listProjectNotes } from "@/lib/db";
import { fetchCommits } from "@/lib/commits";
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
} from "@/app/actions";
import { fetchAirtableRecord, JUSTIFICATION_DISPLAY_FIELDS } from "@/lib/airtable";
import {
  LevelBadge,
  BeaconBadge,
  ShipBadges,
  StatusBadge,
} from "@/app/_components/ProjectBadges";
import { CommitList } from "@/app/_components/CommitList";
import { ProjectNotes } from "@/app/_components/ProjectNotes";
import { PendingButton } from "@/app/_components/PendingButton";
import { renderMarkdown } from "@/lib/markdown";
import { isSafeUrl } from "@/lib/safeUrl";
import { slackHandle } from "@/lib/slack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const access = await requirePagePerm(["review", "warn", "ban"]);
  const { id } = await params;
  const { error } = await searchParams;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) notFound();
  const data = await getProject(projectId);
  if (!data) notFound();
  const { project, journals, verdicts } = data;
  const notes = await listProjectNotes(projectId);
  // The Trial this project was shipped for, if the player flagged one at ship
  // time (joined in getProject). null = they built their own idea.
  const trial = (
    project as {
      sidequests?: {
        name?: string;
        region?: string;
        reward?: string;
        min_hours?: number | null;
      } | null;
    }
  ).sidequests;
  const journalHours =
    Math.round(journals.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 10) /
    10;
  const hackatimeHours =
    Math.round(((project.hackatime_seconds ?? 0) / 3600) * 10) / 10;
  const totalHours = hackatimeHours > 0 ? hackatimeHours : journalHours;
  const commits = await fetchCommits(project.repo_url);
  const ownerHandle = await slackHandle(project.users?.slack_id);
  const collaborators = await listCollaboratorsForProject(projectId);
  // Banning / archiving / rejecting / sending back is an admin action ,
  // reviewers only grade. Gated on the "ban" permission (owners + sub-admins).
  const canModerate = canView(access, ["ban"]);
  // Marking a project Peak is a grading call, not moderation , any reviewer
  // can do it, same as the initial verdict.
  const canPeak = canView(access, ["review"]);
  // Send back to review is a staff action , admins only (not plain reviewers).
  const canReReview =
    canModerate &&
    (project.status === "approved" || project.status === "needs_changes");
  // Deflating hours moves real pixels, can cancel a player's orders, and DMs
  // them , owners/super-admins only (see deflateProjectHours in app/actions.ts).
  const canDeflate =
    access.isSuper &&
    project.status === "approved" &&
    !project.banned_at &&
    !project.rejected_at;
  // What's actually sitting on the Airtable record this project was pushed
  // to (see pushProjectToAirtable) - a staffer's context for whether/how much
  // to deflate, never auto-applied. Only fetched when there's a record to
  // read, and never blocks the page on a slow/failed Airtable call.
  const airtable = project.airtable_record_id
    ? await fetchAirtableRecord(project.airtable_record_id)
    : null;

  return (
    <div>
      <Link href="/projects" className="text-sm text-brand font-bold underline">
        ← all projects
      </Link>
      <div className="flex items-start gap-4 mt-2 mb-1">
        {project.image_url && (
          <img
            src={project.image_url}
            alt=""
            className="w-20 h-20 md:w-24 md:h-24 object-cover border border-border rounded-xl shrink-0"
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight break-words">
              {project.name}
            </h1>
            <StatusBadge status={project.status} />
            {project.is_peak && <BeaconBadge />}
            <LevelBadge level={project.level} />
            <ShipBadges project={project} />
            {project.archived_at && (
              <Badge variant="secondary" className="whitespace-nowrap">
                archived
              </Badge>
            )}
            {project.rejected_at && (
              <Badge className="bg-red-700 text-white whitespace-nowrap">
                rejected
              </Badge>
            )}
            {project.banned_at && (
              <Badge className="bg-rose-900 text-white whitespace-nowrap">
                banned
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground mt-1 flex gap-x-3 gap-y-1 flex-wrap">
            <span>
              by{" "}
              {project.users ? (
                <Link
                  href={`/players/${project.user_id}`}
                  className="font-bold hover:text-brand"
                >
                  {project.users.real_name ||
                    ownerHandle ||
                    project.users.display_name ||
                    project.users.slack_id}
                </Link>
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
                      <Link
                        href={`/players/${c.user_id}`}
                        className="font-bold hover:text-brand"
                      >
                        {c.users.real_name || c.users.display_name || c.users.slack_id}
                      </Link>
                    ) : (
                      c.user_id
                    )}
                    {c.status === "pending" && (
                      <span className="text-muted-foreground"> (invited)</span>
                    )}
                  </span>
                ))}
              </span>
            )}
            <span>created {new Date(project.created_at).toLocaleString()}</span>
            {project.shipped_at && (
              <span>
                shipped {new Date(project.shipped_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="my-4">
          <AlertDescription className="font-bold text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      {project.rejected_at && (
        <Alert variant="destructive" className="mt-4 border-rose-300 dark:border-rose-500/40 bg-rose-500/10">
          <AlertTitle className="font-pixel text-rose-600">
            Rejected{project.reject_by ? ` by ${project.reject_by}` : ""}
          </AlertTitle>
          {project.reject_reason && (
            <AlertDescription className="mt-1 break-words text-foreground">{project.reject_reason}</AlertDescription>
          )}
          <AlertDescription className="mt-2 text-muted-foreground text-xs">
            The owner was told who rejected it, the reason, and to contact the
            Pixl team if it’s a mistake.
          </AlertDescription>
        </Alert>
      )}
      {project.banned_at && (
        <Alert variant="destructive" className="mt-4 border-rose-400 dark:border-rose-500/50 bg-rose-600/10">
          <AlertTitle className="font-pixel text-rose-700 dark:text-rose-400">
            Banned{project.ban_by ? ` by ${project.ban_by}` : ""} , permanent
          </AlertTitle>
          {project.ban_reason && (
            <AlertDescription className="mt-1 break-words text-foreground">{project.ban_reason}</AlertDescription>
          )}
          <AlertDescription className="mt-2 text-muted-foreground text-xs">
            This project can never be shipped again. The owner was told who
            banned it, the reason, and to contact the Pixl team.
          </AlertDescription>
        </Alert>
      )}
      {project.system_note && (
        <Alert className="mt-4 border-brand/30 bg-brand/10 dark:bg-brand/20">
          <AlertDescription className="font-bold text-brand">{project.system_note}</AlertDescription>
        </Alert>
      )}

      <Card className="p-5 my-6 gap-0">
        {project.description ? (
          <p className="text-sm break-words">{project.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
        {project.is_update && project.update_notes && (
          <div className="mt-3 border border-border rounded-lg bg-muted p-3 text-sm">
            <span className="font-pixel">what changed since last approval</span>
            <div className="mt-1 whitespace-pre-wrap break-words">
              {project.update_notes}
            </div>
          </div>
        )}
        <div className="flex gap-2 flex-wrap mt-4 text-sm font-bold">
          {project.repo_url && isSafeUrl(project.repo_url) && (
            <Button asChild variant="secondary">
              <a href={project.repo_url} target="_blank" rel="noreferrer">
                Repo
              </a>
            </Button>
          )}
          {project.demo_url && isSafeUrl(project.demo_url) && (
            <Button asChild variant="secondary">
              <a href={project.demo_url} target="_blank" rel="noreferrer">
                Demo
              </a>
            </Button>
          )}
          {!isSafeUrl(project.repo_url) && !isSafeUrl(project.demo_url) && (
            <span className="text-muted-foreground font-normal">No links yet.</span>
          )}
        </div>
        {trial?.name && (
          <div className="mt-3">
            <Badge variant="secondary" className="font-bold">
              Trial: {trial.name}
              {trial.region ? ` · ${trial.region}` : ""}
              {trial.reward ? ` · reward: ${trial.reward}` : ""}
              {trial.min_hours != null ? ` · min ${trial.min_hours}h` : ""}
            </Badge>
          </div>
        )}
        {project.hackatime_projects?.length > 0 && (
          <div className="text-xs text-muted-foreground mt-3">
            hackatime: {project.hackatime_projects.join(", ")}
          </div>
        )}
        {project.review_note && (
          <div className="mt-4 border border-border rounded-lg bg-muted p-3 text-sm">
            <span className="font-pixel">
              reviewer note{project.review_note_by ? ` , by ${project.review_note_by}` : ""}
            </span>
            <div className="mt-1 break-words">{project.review_note}</div>
          </div>
        )}
      </Card>

      {canPeak && (
        <Card className="p-4 mb-8 gap-0">
          <div className="font-pixel text-xl mb-1">Beacon</div>
          <p className="text-sm text-muted-foreground mb-3">
            Nominate a standout project. Purely cosmetic , shown wherever this
            project is displayed publicly, never a payout change.
          </p>
          <form action={toggleProjectPeak}>
            <input type="hidden" name="projectId" value={project.id} />
            {!project.is_peak && <input type="hidden" name="isPeak" value="1" />}
            <PendingButton
              variant={project.is_peak ? "outline" : undefined}
              className={project.is_peak ? "" : "bg-amber-500 text-black hover:bg-amber-600 border-transparent"}
              pendingText={project.is_peak ? "Removing…" : "Marking…"}
            >
              {project.is_peak ? "Remove Beacon" : "★ Mark as Beacon"}
            </PendingButton>
          </form>
        </Card>
      )}

      {canModerate && (
        <Card className="p-4 mb-8 gap-0">
          <div className="font-pixel text-xl mb-1">Staff actions</div>
          <p className="text-sm text-muted-foreground mb-3">
            Everything here is reversible and kept in history , nothing is
            erased.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {canReReview && (
              <form action={reReviewProject}>
                <input type="hidden" name="projectId" value={project.id} />
                <PendingButton
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  pendingText="Sending…"
                >
                  Send back to review
                </PendingButton>
              </form>
            )}
            {canModerate && (
              <form action={archiveProject}>
                <input type="hidden" name="projectId" value={project.id} />
                {project.archived_at && (
                  <input type="hidden" name="unarchive" value="1" />
                )}
                <PendingButton
                  variant="outline"
                  pendingText={project.archived_at ? "Unarchiving…" : "Archiving…"}
                >
                  {project.archived_at ? "Unarchive" : "Archive"}
                </PendingButton>
              </form>
            )}
            {canModerate && project.rejected_at && (
              <form action={unrejectProject}>
                <input type="hidden" name="projectId" value={project.id} />
                <PendingButton
                  className="bg-mint text-ink hover:bg-mint/90"
                  pendingText="Restoring…"
                >
                  Restore (un-reject)
                </PendingButton>
              </form>
            )}
            {canModerate && project.banned_at && (
              <form action={unbanProject}>
                <input type="hidden" name="projectId" value={project.id} />
                <PendingButton
                  className="bg-mint text-ink hover:bg-mint/90"
                  pendingText="Lifting…"
                >
                  Lift ban
                </PendingButton>
              </form>
            )}
            {canModerate && project.status === "approved" && !project.banned_at && !project.rejected_at && (
              <form action={sendProjectToAirtable}>
                <input type="hidden" name="projectId" value={project.id} />
                <PendingButton
                  variant="outline"
                  pendingText="Sending…"
                >
                  {project.airtable_record_id ? "Re-send to Airtable" : "Send to Airtable"}
                </PendingButton>
              </form>
            )}
          </div>
          {canModerate && !project.rejected_at && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-sm font-medium text-rose-600 mb-1">
                Reject project
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Removes this project from Pixl and tells the owner who rejected
                it and why. Reversible. This is not a player ban , ban the
                player from their{" "}
                <Link
                  href={`/players/${project.user_id}`}
                  className="text-brand hover:underline"
                >
                  player page
                </Link>
                .
              </p>
              <form
                action={rejectProject}
                className="flex flex-wrap gap-2 items-start"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="reason"
                  required
                  placeholder="Reason (shown to the owner)…"
                  className="flex-1 min-w-64 text-sm"
                />
                <PendingButton
                  className="bg-rose-600 text-white border-transparent hover:bg-rose-700"
                  pendingText="Rejecting…"
                  confirm="Reject this project? The owner is told who rejected it and why."
                >
                  Reject project
                </PendingButton>
              </form>
            </div>
          )}
          {canModerate && !project.banned_at && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-sm font-medium text-rose-700 dark:text-rose-400 mb-1">
                Ban project (permanent)
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Permanently bans this project , it can never be shipped again
                and is hidden everywhere. Different from a reject. Reversible by
                staff.
              </p>
              <form
                action={banProject}
                className="flex flex-wrap gap-2 items-start"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="reason"
                  required
                  placeholder="Reason for the ban (shown to the owner)…"
                  className="flex-1 min-w-64 text-sm"
                />
                <PendingButton
                  className="bg-rose-800 text-white border-transparent hover:bg-rose-900"
                  pendingText="Banning…"
                  confirm="Permanently ban this project? It can never be shipped again."
                >
                  Ban project
                </PendingButton>
              </form>
            </div>
          )}
          {canDeflate && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
                Deflate approved hours
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Lowers this project's credited hours after approval , e.g.
                Hack Club HQ flagged an over-claim in Airtable. Automatically
                claws back pixels for the owner (and, proportionally, any
                accepted collaborators) down to what the new hours are worth,
                DMs everyone affected with your reason, and auto-cancels any
                pending order that can no longer be covered. Deflate only ,
                never raises hours back up. Current: {project.approved_hours ?? totalHours}h.
              </p>
              <form
                action={deflateProjectHours}
                className="flex flex-wrap gap-2 items-start"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="newHours"
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  placeholder="New hours…"
                  className="w-32 text-sm"
                />
                <Textarea
                  name="reason"
                  required
                  placeholder="Reason (shown to the owner, and any affected collaborators)…"
                  className="flex-1 min-w-64 text-sm"
                  rows={2}
                />
                <PendingButton
                  className="bg-amber-600 text-white border-transparent hover:bg-amber-700"
                  pendingText="Deflating…"
                  confirm="Deflate this project's hours? This immediately claws back pixels (and may cancel pending orders) for the owner and any collaborators, and DMs them why."
                >
                  Deflate hours
                </PendingButton>
              </form>
            </div>
          )}
        </Card>
      )}

      {project.hours_deflated_at && (
        <Alert className="mt-4 border-amber-400 dark:border-amber-500/40 bg-amber-500/10">
          <AlertTitle className="font-pixel text-amber-700 dark:text-amber-400">
            Hours deflated{project.hours_deflated_by ? ` by ${project.hours_deflated_by}` : ""} on{" "}
            {new Date(project.hours_deflated_at).toLocaleString()}
          </AlertTitle>
          {project.deflation_reason && (
            <AlertDescription className="mt-1 break-words text-foreground">
              {project.deflation_reason}
            </AlertDescription>
          )}
        </Alert>
      )}

      {project.airtable_record_id && (
        <Card className="p-5 my-6 gap-0">
          <div className="font-pixel text-xl mb-1">Airtable record</div>
          {!airtable || !airtable.ok ? (
            <p className="text-sm text-muted-foreground">
              {airtable ? `Couldn't load: ${airtable.error}` : "Not sent to Airtable yet."}
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              {(() => {
                const hoursOnAirtable = airtable.fields["Optional - Override Hours Spent"];
                return typeof hoursOnAirtable === "number" ? (
                  <div
                    className={
                      project.approved_hours !== null && hoursOnAirtable !== project.approved_hours
                        ? "font-bold text-amber-700 dark:text-amber-400"
                        : "font-bold"
                    }
                  >
                    Hours on Airtable: {hoursOnAirtable}h
                    {project.approved_hours !== null &&
                      hoursOnAirtable !== project.approved_hours &&
                      ` (Pixl has ${project.approved_hours}h , mismatch)`}
                  </div>
                ) : null;
              })()}
              {JUSTIFICATION_DISPLAY_FIELDS.filter((f) => f !== "Optional - Override Hours Spent").map(
                (field) => {
                  const value = airtable.fields[field];
                  if (value === undefined || value === null || value === "") return null;
                  return (
                    <div key={field}>
                      <div className="font-pixel text-muted-foreground text-xs">{field}</div>
                      <div className="whitespace-pre-wrap break-words">{String(value)}</div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-4 gap-0">
          <div className="text-3xl md:text-4xl font-bold text-brand">
            {totalHours}h
          </div>
          <div className="font-pixel text-muted-foreground text-sm">
            {hackatimeHours > 0 ? "Hackatime" : "logged"}
            {project.approved_hours !== null &&
              ` · ${project.approved_hours}h credited`}
          </div>
        </Card>
        <Card className="p-4 gap-0">
          <div className="text-3xl md:text-4xl font-bold text-brand">
            {journals.length}
          </div>
          <div className="font-pixel text-muted-foreground text-sm">journal entries</div>
        </Card>
        <Card className="p-4 gap-0 col-span-2 sm:col-span-1">
          <div className="text-3xl md:text-4xl font-bold text-brand">
            {commits.commits.length}
          </div>
          <div className="font-pixel text-muted-foreground text-sm">recent commits</div>
        </Card>
      </div>

      <h2 className="text-lg font-semibold text-foreground tracking-tight mb-3">
        Commits
      </h2>
      <Card className="mb-8 py-0 overflow-hidden">
        <CommitList result={commits} />
      </Card>

      <h2 className="text-lg font-semibold text-foreground tracking-tight mb-3">
        Journal
      </h2>
      <Card className="divide-y divide-border mb-8 py-0">
        {journals.length === 0 && (
          <div className="p-5 text-muted-foreground text-sm">No journal entries yet.</div>
        )}
        {journals.map((j) => (
          <div key={j.id} className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <Badge variant="secondary">
                {Math.round((Number(j.hours) || 0) * 10) / 10}h
              </Badge>
              {j.edited_at && (
                <span className="text-xs text-muted-foreground">
                  edited {new Date(j.edited_at).toLocaleString()}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {new Date(j.created_at).toLocaleString()}
              </span>
            </div>
            {j.title && (
              <div className="text-sm font-semibold mb-1">{j.title}</div>
            )}
            <div
              className="md text-sm break-words text-foreground/80"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(j.content) }}
            />
          </div>
        ))}
      </Card>

      <ProjectNotes projectId={project.id} notes={notes} className="mb-8" />

      <h2 className="text-lg font-semibold text-foreground tracking-tight mb-3">
        Review history
      </h2>
      <Card className="divide-y divide-border py-0">
        {verdicts.length === 0 && (
          <div className="p-5 text-muted-foreground text-sm">Not reviewed yet.</div>
        )}
        {verdicts.map((v) => (
          <div
            key={v.id}
            className="p-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          >
            <Badge
              variant={
                v.action === "project_approved"
                  ? "success"
                  : v.action === "review_reverted"
                    ? "info"
                    : v.action === "project_first_pass"
                      ? "secondary"
                      : v.action === "project_hours_deflated"
                        ? "warning"
                        : "destructive"
              }
              className="shrink-0"
            >
              {v.action === "project_approved"
                ? "approved"
                : v.action === "review_reverted"
                  ? "reverted"
                  : v.action === "project_first_pass"
                    ? "first pass"
                    : v.action === "project_hours_deflated"
                      ? "hours deflated"
                      : "sent back"}
            </Badge>
            <div className="flex-1 min-w-48">
              <span className="font-bold">{v.actor}</span>
              <div className="text-foreground/70 break-words">{v.detail}</div>
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {new Date(v.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
