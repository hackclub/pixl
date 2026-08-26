import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePerm, requireGuidelinesAck } from "@/lib/guard";
import { decryptPII } from "@/lib/crypto";
import {
  getProject,
  listShippedProjects,
  listSecondReviewProjects,
  claimReview,
  turnedNineteenSinceShipping,
  listCollaboratorsForProject,
  lifetimeRe,
  getFirstPassAuditNote,
} from "@/lib/db";
import { parseAuditNote } from "@/lib/auditNote";
import { fetchCommits, attachCommitStats } from "@/lib/github";
import { fetchUserSpans, attachTrackedTime, fetchTrustFactor, fetchHackatimeReport } from "@/lib/hackatime";
import { yswsShipsFor } from "@/lib/ysws";
import { renderMarkdown } from "@/lib/markdown";
import { db } from "@/lib/db";
import { ReviewForm, type BountyOption } from "@/app/_components/ReviewForm";
import {
  banProject,
  setProjectLevel,
  sendBackToFirstPass,
  forceAdvanceFraud,
  toggleProjectPeak,
  extendHoursCutoff,
} from "@/app/actions";
import { hackatimeCutoffUnix, hackatimeCutoffLabel } from "@/app/_generated/config";
import { PendingButton } from "@/app/_components/PendingButton";
import { ReviewDetailTabs } from "@/app/_components/ReviewDetailTabs";
import { LevelBadge, TypeBadge, ShipBadges, StatusBadge, BeaconBadge, FundingBadge } from "@/app/_components/ProjectBadges";
import { slackHandle } from "@/lib/slack";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

function ageFrom(bday: string | null | undefined): number | null {
  if (!bday) return null;
  const b = new Date(bday);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

function fmtHM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function ago(iso: string | null): string {
  if (!iso) return "unknown";
  const d = Math.max(0, Date.now() - new Date(iso).getTime());
  const days = Math.floor(d / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hrs = Math.floor(d / 3_600_000);
  if (hrs >= 1) return `${hrs}h ago`;
  return `${Math.floor(d / 60_000)}m ago`;
}

const TRUST_VARIANT = (
  level: string,
): "success" | "destructive" | "warning" | "info" | "secondary" =>
  level === "green"
    ? "success"
    : level === "red" || level === "convicted"
      ? "destructive"
      : level === "yellow" || level === "suspected"
        ? "warning"
        : "secondary";

// Hackatime returns "blue" for accounts it hasn't scored yet.
const TRUST_LABEL = (level: string): string =>
  level === "blue" ? "unscored" : level;

export default async function ReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const access = await requirePagePerm(["review"]);
  await requireGuidelinesAck(access);
  const viewer = access.session.slackId;
  const canSecondPass = access.canSecondPass;
  // Only admins (ban perm) may permanently ban a project from the review page.
  const canModerate = access.perms.has("ban");
  const { id } = await params;
  const { error } = await searchParams;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) notFound();

  // getProject and listCollaboratorsForProject don't depend on each other
  // (the latter only needs projectId), so they run together instead of one
  // after the other.
  const [data, allCollaborators] = await Promise.all([
    getProject(projectId),
    listCollaboratorsForProject(projectId),
  ]);
  if (!data) notFound();
  const { project: p, journals, verdicts } = data;
  // The Trial this project was shipped for, if the player flagged one at ship
  // time (joined in getProject). null = they built their own idea.
  const trial = (
    p as { sidequests?: { name?: string; region?: string; reward?: string; min_hours?: number | null } | null }
  ).sidequests;

  const isFinalStage = p.status === "second_review";
  const isOwn = !!p.users?.slack_id && p.users.slack_id === viewer && !access.isSuper;
  const canReview =
    (p.status === "shipped" && !isOwn) || (isFinalStage && canSecondPass);
  const shippedAt = (p as { shipped_at?: string | null }).shipped_at ?? null;

  // Everything below only depends on `p` (already resolved above), not on
  // each other, so they run concurrently rather than as a chain of
  // sequential round-trips - same conditions and fallbacks as before, just
  // not waited on one at a time.
  const [claim, playerReBefore, firstPassAuditNote, bountyEventsResult] = await Promise.all([
    canReview
      ? claimReview(projectId, viewer)
      : Promise.resolve({ ok: true as const, by: undefined }),
    // The RE the player already holds, excluding this project — this is what
    // sets the rate they'll be paid at, so the reviewer sees it before deciding.
    lifetimeRe(p.user_id, projectId),
    // So the final reviewer starts from what the first reviewer already wrote
    // instead of a blank form - they can still edit or overturn any of it.
    isFinalStage && p.first_pass_by ? getFirstPassAuditNote(projectId) : Promise.resolve(null),
    shippedAt
      ? db
          .from("events")
          .select("*")
          .eq("type", "bounty")
          .is("stopped_at", null)
          .lte("starts_at", shippedAt)
          .gt("ends_at", shippedAt)
      : Promise.resolve({ data: [] as { id: number; name: string; config: Record<string, unknown> }[] }),
  ]);
  const claimHandle = !claim.ok && claim.by ? await slackHandle(claim.by) : null;

  const journalHours =
    Math.round(journals.reduce((s, j) => s + (Number(j.hours) || 0), 0) * 10) / 10;
  const hackatimeHours = Math.round(((p.hackatime_seconds ?? 0) / 3600) * 10) / 10;
  // For hardware ships, hackatime_seconds is already journal + Hackatime combined
  // (see 0130_project_kind.sql / the ship route) — adding journalHours again here
  // would double-count it. Same "hackatime if tracked, else journal" rule
  // claimedHoursFor() in actions.ts uses for the actual payout, kept in sync so
  // the cap shown here matches what reviewProject will credit.
  const hours = hackatimeHours > 0 ? hackatimeHours : journalHours;
  const htPct = hours > 0 ? Math.round((hackatimeHours / hours) * 100) : 0;

  // Same "hackatime if tracked, else journal" source-of-truth as
  // claimedHoursFor() in actions.ts uses for the owner — kept consistent so
  // the cap shown here matches what reviewProject actually enforces.
  const acceptedCollaborators = allCollaborators.filter((c) => c.status === "accepted");
  const collaboratorHours = acceptedCollaborators.map((c) => {
    const cJournalHours =
      Math.round(
        journals
          .filter((j) => j.user_id === c.user_id)
          .reduce((s, j) => s + (Number(j.hours) || 0), 0) * 10,
      ) / 10;
    const cHackatimeHours = Math.round(((c.hackatime_seconds ?? 0) / 3600) * 10) / 10;
    return {
      id: c.id,
      name: c.users?.real_name || c.users?.display_name || c.users?.slack_id || c.user_id,
      claimedHours: cHackatimeHours > 0 ? cHackatimeHours : cJournalHours,
    };
  });

  const formDefaultHours =
    isFinalStage && p.first_pass_hours != null ? p.first_pass_hours : hours;

  const firstPassAudit = firstPassAuditNote ? parseAuditNote(firstPassAuditNote) : null;

  const firstPassDeflated =
    p.first_pass_hours != null ? Math.round((hours - p.first_pass_hours) * 10) / 10 : 0;
  const firstPassCutPct =
    p.first_pass_hours != null && hours > 0
      ? Math.round(((hours - p.first_pass_hours) / hours) * 100)
      : 0;

  const ageFlag = turnedNineteenSinceShipping(p.users?.birthday, shippedAt);
  // One day before the global cutoff, for the extend-hours date input's max.
  const maxExtendDateStr = new Date((hackatimeCutoffUnix - 86_400) * 1000)
    .toISOString()
    .slice(0, 10);
  const bounties: BountyOption[] = ((bountyEventsResult.data ?? []) as {
    id: number;
    name: string;
    config: Record<string, unknown>;
  }[]).map((ev) => ({
    id: ev.id,
    name: ev.name,
    reward: Number(ev.config.reward) || 0,
    description: String(ev.config.description ?? ""),
  }));

  // These calls hit GitHub, Hackatime, the YSWS archive, Slack and the DB.
  // They're independent, so run them concurrently , the page is only as slow as
  // the slowest one, not their sum. The commit stats + tracked-time attach form
  // one chain (both mutate `commits`) that runs alongside the rest.
  const hackatimeProjects = p.hackatime_projects ?? [];
  const tokenPromise = hackatimeProjects.length
    ? db
        .from("users")
        .select("hackatime_token")
        .eq("id", p.user_id)
        .single()
        .then((r) => (r.data as { hackatime_token?: string } | null)?.hackatime_token ?? null)
    : Promise.resolve(null);

  const commitsChain = (async () => {
    const commits = await fetchCommits(p.repo_url);
    await attachCommitStats(commits);
    if (commits.commits.length > 0 && hackatimeProjects.length > 0) {
      const spans = await fetchUserSpans(p.users?.slack_id, await tokenPromise, hackatimeProjects);
      if (spans) attachTrackedTime(commits.commits, spans);
    }
    return commits;
  })();

  const hackatimeReportPromise = hackatimeProjects.length
    ? tokenPromise.then((tok) => fetchHackatimeReport(p.users?.slack_id, tok, hackatimeProjects))
    : Promise.resolve(null);

  const [commits, trust, yswsShips, ownerHandle, queue, hackatimeReport] = await Promise.all([
    commitsChain,
    fetchTrustFactor(p.users?.slack_id),
    yswsShipsFor(p.users?.slack_id, p.repo_url, p.demo_url),
    slackHandle(p.users?.slack_id),
    isFinalStage ? listSecondReviewProjects(viewer) : listShippedProjects(viewer),
    hackatimeReportPromise,
  ]);
  const ownerName =
    p.users?.real_name || ownerHandle || p.users?.display_name || p.users?.slack_id || p.user_id;
  // projects.id is a Postgres bigint; compare numerically rather than with
  // strict equality so a bigint serialized as a string by the DB client
  // doesn't silently miss the match and strand prev/next at "not in queue".
  const idx = queue.findIndex((q) => Number(q.id) === projectId);
  const prev = idx > 0 ? queue[idx - 1] : null;
  const next = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;

  return (
    <div>
      <Link href="/review" className="text-sm text-brand font-medium hover:underline">
        ← Needs review
      </Link>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription className="font-medium text-destructive">{error}</AlertDescription>
        </Alert>
      )}
      {!claim.ok && (
        <Alert className="mt-4 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10">
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            Heads up , {claimHandle ?? claim.by ?? "another reviewer"} is already reviewing this
            submission. Avoid double-grading it.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col lg:flex-row gap-6 pb-24 mt-4">
        {/* main */}
        <div className="flex-1 min-w-0 space-y-5">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <StatusBadge status={p.status} />
              <LevelBadge level={p.level} />
              <TypeBadge type={p.project_type} />
              <ShipBadges project={p} />
              <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
              {p.is_peak && <BeaconBadge />}
              {trial?.name && (
                <Badge variant="secondary" className="font-bold">
                  Trial: {trial.name}
                  {trial.min_hours != null ? ` · min ${trial.min_hours}h` : ""}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground font-mono ml-auto">#{p.id}</span>
            </div>
            {!isOwn && (
              <form action={setProjectLevel} className="flex items-center gap-2 mb-3 text-sm">
                <input type="hidden" name="projectId" value={p.id} />
                <label className="text-muted-foreground">Re-grade tier</label>
                <select
                  name="level"
                  defaultValue={p.level ?? 1}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  <option value={1}>T1 · Spark</option>
                  <option value={2}>T2 · Signal</option>
                  <option value={3}>T3 · Grid</option>
                  <option value={4}>T4 · Nexus</option>
                </select>
                <PendingButton variant="secondary" size="sm" pendingText="Saving…">
                  Set
                </PendingButton>
              </form>
            )}
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight break-words">{p.name}</h1>
            {p.description && (
              <div
                className="md text-muted-foreground mt-2 break-words"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(p.description) }}
              />
            )}
          </div>

          {p.image_url && (
            <img
              src={p.image_url}
              alt=""
              className="w-full max-h-96 object-contain rounded-xl border border-border bg-black/40"
            />
          )}

          {p.needs_funding && (
            <div className="rounded-xl border border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm space-y-3">
              <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                Funding requested: ${Number(p.funding_usd ?? 0).toFixed(2)}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Bill of Materials</div>
                {p.bom_url ? (
                  <a
                    href={p.bom_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand font-medium hover:underline"
                  >
                    Download BOM (.csv) ↗
                  </a>
                ) : (
                  <span className="text-muted-foreground">Not uploaded.</span>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Cart screenshot{(p.cart_screenshot_urls ?? []).length === 1 ? "" : "s"}
                </div>
                {(p.cart_screenshot_urls ?? []).length ? (
                  <div className="flex flex-wrap gap-2">
                    {(p.cart_screenshot_urls ?? []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt={`Cart screenshot ${i + 1}`}
                          className="w-24 h-24 object-cover rounded-lg border border-border"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">None uploaded.</span>
                )}
              </div>
            </div>
          )}

          {p.system_note && (
            <Alert className="border-brand/30 bg-brand/10">
              <AlertDescription className="font-medium text-brand">{p.system_note}</AlertDescription>
            </Alert>
          )}
          {(() => {
            const aiCommits = commits.commits.filter((c) => c.ai).length;
            if (aiCommits === 0 || p.used_ai) return null;
            return (
              <Alert className="border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10">
                <AlertDescription className="font-medium text-violet-700 dark:text-violet-300">
                  {aiCommits} commit{aiCommits === 1 ? "" : "s"} in this repo {aiCommits === 1 ? "is" : "are"} signed
                  by an AI tool, but the maker did not tick &ldquo;AI used&rdquo;. Undisclosed AI ,
                  verify before crediting.
                </AlertDescription>
              </Alert>
            );
          })()}
          {p.is_update && p.update_notes && (
            <div className="rounded-xl border border-blue-300 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-500/10 p-4 text-sm">
              <div className="font-semibold mb-1 text-blue-700 dark:text-blue-300">
                What changed since last approval
              </div>
              <div className="whitespace-pre-wrap break-words text-blue-900/90 dark:text-blue-200/90">
                {p.update_notes}
              </div>
            </div>
          )}
          {p.other_ysws_notes && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm">
              <div className="font-semibold mb-1 text-amber-700 dark:text-amber-300">
                What changed since their other YSWS submission
              </div>
              <div className="whitespace-pre-wrap break-words text-amber-900/90 dark:text-amber-200/90">
                {p.other_ysws_notes}
              </div>
            </div>
          )}
          {p.ship_note && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm">
              <div className="font-semibold mb-1 text-amber-700 dark:text-amber-300">
                Note from the builder
              </div>
              <div className="whitespace-pre-wrap break-words text-amber-900/90 dark:text-amber-200/90">
                {p.ship_note}
              </div>
            </div>
          )}
          {p.used_ai && (
            <div className="rounded-xl border border-violet-300 dark:border-violet-500/40 bg-violet-50 dark:bg-violet-500/10 p-4 text-sm">
              <div className="font-semibold mb-1 text-violet-700 dark:text-violet-300">
                AI declaration
              </div>
              <div className="whitespace-pre-wrap break-words text-violet-900/90 dark:text-violet-200/90">
                {p.ai_notes || "Player ticked “AI used” but gave no details (pre-dates the details field)."}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="grid place-items-center w-8 h-8 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0">
                {String(ownerName).replace(/^@/, "").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <Link href={`/players/${p.user_id}`} className="font-medium hover:text-brand truncate block">
                  {ownerName}
                </Link>
                {p.users?.slack_id && (
                  <a
                    href={`https://hackclub.slack.com/team/${p.users.slack_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-muted-foreground hover:text-brand"
                    title="Open in Slack"
                  >
                    {p.users.slack_id}
                  </a>
                )}
              </div>
            </div>
            {acceptedCollaborators.length > 0 && (
              <div className="text-xs text-muted-foreground">
                with{" "}
                {acceptedCollaborators
                  .map((c) => c.users?.real_name || c.users?.display_name || c.users?.slack_id || c.user_id)
                  .join(", ")}
              </div>
            )}
            {p.repo_url && (
              <Button asChild variant="secondary" size="sm">
                <a href={p.repo_url} target="_blank" rel="noreferrer">
                  Repo ↗
                </a>
              </Button>
            )}
            {p.repo_url && (
              <Button asChild variant="secondary" size="sm">
                <a href={`${p.repo_url.replace(/\/$/, "")}#readme`} target="_blank" rel="noreferrer">
                  README ↗
                </a>
              </Button>
            )}
            {p.demo_url && (
              <Button asChild variant="secondary" size="sm">
                <a href={p.demo_url} target="_blank" rel="noreferrer">
                  Live demo ↗
                </a>
              </Button>
            )}
          </div>

          {/* Eligibility check — YSWS submission guideline gaps (exclusions,
              builder unified-DB fields, README). */}
          {(() => {
            const u = p.users as
              | {
                  first_name?: string | null;
                  last_name?: string | null;
                  real_name?: string | null;
                  email?: string | null;
                  birthday?: string | null;
                  address_line1?: string | null;
                  address_line2?: string | null;
                  address_city?: string | null;
                  address_state?: string | null;
                  address_country?: string | null;
                  address_postal?: string | null;
                }
              | null
              | undefined;
            // PII (name/email/birthday/address) is encrypted at rest; decryptPII
            // also passes legacy plaintext through unchanged.
            const dec = (v: string | null | undefined) => decryptPII(v) || "";
            const birthday = dec(u?.birthday);
            const builderAge = ageFrom(birthday);
            const fullName = [dec(u?.first_name), dec(u?.last_name)].filter(Boolean).join(" ") || u?.real_name || "—";
            const country = dec(u?.address_country);
            const address =
              [dec(u?.address_line1), dec(u?.address_line2), dec(u?.address_city), dec(u?.address_state), dec(u?.address_postal), country]
                .filter(Boolean)
                .join(", ") || "—";
            return (
              <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm space-y-2">
                <div className="font-semibold text-amber-800 dark:text-amber-300">Eligibility check</div>
                <ul className="list-disc pl-5 space-y-0.5 text-amber-900/90 dark:text-amber-200/90">
                  <li>
                    <strong>Not</strong> a school assignment, and <strong>not</strong> built as paid Hack Club work — both
                    are ineligible for the unified database.
                  </li>
                  <li>Repo has a usable README and the live demo actually works.</li>
                </ul>
                <details className="text-amber-900/90 dark:text-amber-200/90">
                  <summary className="cursor-pointer font-medium select-none">
                    Builder details (name · email · age · shipping)
                  </summary>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Name:</span> {fullName}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email:</span> {dec(u?.email) || "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Age:</span>{" "}
                      {builderAge != null
                        ? `${builderAge}${isFinalStage && birthday ? ` (born ${birthday})` : ""}`
                        : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Country:</span> {country || "—"}
                    </div>
                    {isFinalStage && (
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Address:</span> {address}
                      </div>
                    )}
                  </div>
                </details>
              </div>
            );
          })()}

          <div className="text-xs text-muted-foreground">
            Submitted {ago(p.shipped_at)} · {fmtHM(hours)} logged
            {p.hackatime_projects?.length > 0 && (
              <>
                {" · "}
                <a href="#hackatime" className="text-brand hover:underline">
                  hackatime: {p.hackatime_projects.join(", ")}
                </a>
              </>
            )}
          </div>

          <ReviewDetailTabs
            commits={commits}
            journals={journals}
            verdicts={verdicts}
            yswsShips={yswsShips}
            yswsImport={
              p.imported_from_ysws
                ? {
                    ysws: String(p.imported_from_ysws),
                    hours: Number(p.imported_ysws_hours) || 0,
                    approvedAt: p.imported_ysws_approved_at
                      ? String(p.imported_ysws_approved_at)
                      : null,
                  }
                : null
            }
            hackatime={hackatimeReport}
            repoUrl={p.repo_url ?? null}
            projectKind={p.kind}
          />
        </div>

        {/* sidebar */}
        <aside className="lg:w-[30rem] shrink-0">
          <div className="lg:sticky lg:top-24 space-y-4">
            <Card className="p-5 gap-0">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Logged hours
              </div>
              <div className="mt-1 mb-3">
                <span className="text-3xl font-bold">{fmtHM(hours)}</span>{" "}
                <span className="text-muted-foreground text-sm">logged</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                <div className="h-full bg-[color:var(--color-hc-blue)]" style={{ width: `${htPct}%` }} />
                <div className="h-full bg-[color:var(--color-hc-purple)]" style={{ width: `${100 - htPct}%` }} />
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <a href="#hackatime" className="flex items-center gap-2 hover:text-brand" title="See the full Hackatime breakdown">
                  <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--color-hc-blue)]" />
                  <span className="text-foreground/70">Hackatime →</span>
                  <span className="ml-auto tabular-nums font-medium">{fmtHM(hackatimeHours)}</span>
                </a>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--color-hc-purple)]" />
                  <span className="text-foreground/70">Journals</span>
                  <span className="ml-auto tabular-nums font-medium">{fmtHM(journalHours)}</span>
                </div>
              </div>
              {p.hours_extended_since && (
                <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                  Counting hours from{" "}
                  <span className="font-medium text-foreground">
                    {new Date(p.hours_extended_since).toLocaleDateString()}
                  </span>{" "}
                  (before the {hackatimeCutoffLabel} cutoff) , set by{" "}
                  <span className="font-medium text-foreground">{p.hours_extended_by}</span>:{" "}
                  {p.hours_extended_note}
                </div>
              )}
            </Card>

            <Card className="p-4 gap-0 flex-row items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Beacon</div>
                <p className="text-xs text-muted-foreground">
                  Nominate a standout project , cosmetic only, never affects payout.
                </p>
              </div>
              <form action={toggleProjectPeak}>
                <input type="hidden" name="projectId" value={p.id} />
                {!p.is_peak && <input type="hidden" name="isPeak" value="1" />}
                <PendingButton
                  size="sm"
                  variant={p.is_peak ? "outline" : undefined}
                  className={p.is_peak ? "" : "bg-amber-500 text-black hover:bg-amber-600 border-transparent"}
                  pendingText={p.is_peak ? "Removing…" : "Marking…"}
                >
                  {p.is_peak ? "Remove" : "★ Mark"}
                </PendingButton>
              </form>
            </Card>

            {trust && (
              <Card className="p-4 flex-row items-center gap-3">
                <Badge variant={TRUST_VARIANT(trust.level)}>{TRUST_LABEL(trust.level)}</Badge>
                <span className="text-xs text-muted-foreground">
                  Hackatime trust factor , {trust.level === "green"
                    ? "no fraud flags on this account."
                    : trust.level === "red" || trust.level === "convicted"
                      ? "Hackatime has convicted this account of fraud. Do not credit without digging."
                      : trust.level === "yellow" || trust.level === "suspected"
                        ? "Hackatime suspects this account , verify carefully."
                        : "not scored yet."}
                </span>
              </Card>
            )}

            {isFinalStage && (
              <Card className="p-5 gap-0 ring-violet-300 dark:ring-violet-500/30">
                <div className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide mb-2">
                  First pass
                </div>
                {p.first_pass_verdict && p.first_pass_verdict !== "approved" && (
                  <div className="mb-2 rounded-md bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    ⚠ First reviewer proposed{" "}
                    {p.first_pass_verdict === "banned" ? "a BAN" : "changes"} , confirm it, or approve to overturn.
                  </div>
                )}
                <div className="text-sm text-foreground/70">
                  {p.first_pass_verdict === "banned"
                    ? "Ban proposed by "
                    : p.first_pass_verdict === "needs_changes"
                      ? "Changes proposed by "
                      : "Passed by "}
                  <span className="font-medium text-foreground">{p.first_pass_by || "a reviewer"}</span>
                  {p.first_pass_hours != null && (
                    <>
                      {" "}
                      · credited <span className="font-medium text-foreground">{p.first_pass_hours}h</span> of{" "}
                      {hours}h claimed
                    </>
                  )}
                </div>
                {firstPassDeflated > 0 && (
                  <div className="mt-1 text-sm font-medium text-rose-600 dark:text-rose-400">
                    Deflated {firstPassDeflated}h {firstPassCutPct > 0 ? `(−${firstPassCutPct}%)` : ""}
                  </div>
                )}
                {p.first_pass_note && (
                  <p className="mt-2 text-sm whitespace-pre-wrap break-words text-foreground/80">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Their note:{" "}
                    </span>
                    {p.first_pass_note}
                  </p>
                )}
              </Card>
            )}

            {(p.joe_project_id || p.joe_error) && (
              <Card className="p-5 gap-0 space-y-2">
                <div className="text-sm font-semibold">Fraud review (Joe)</div>
                {p.joe_error ? (
                  <p className="text-sm text-rose-600">
                    Not submitted to Joe: {p.joe_error}
                  </p>
                ) : p.joe_outcome ? (
                  <dl className="text-sm grid grid-cols-2 gap-1">
                    <dt>Outcome</dt>
                    <dd>{p.joe_outcome}</dd>
                    <dt>Trust score</dt>
                    <dd>{p.joe_trust_score ?? "not given"}</dd>
                    {p.joe_reason && (
                      <>
                        <dt>Reason</dt>
                        <dd>{p.joe_reason}</dd>
                      </>
                    )}
                    <dt>Reviewer</dt>
                    <dd>{p.joe_reviewer || "unknown"}</dd>
                    <dt>Reviewed</dt>
                    <dd>{p.joe_reviewed_at ? new Date(p.joe_reviewed_at).toLocaleString() : "not yet"}</dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Submitted to Joe, waiting on a score.
                  </p>
                )}
                {p.status === "fraud_review" && canSecondPass && (
                  <form action={forceAdvanceFraud} className="flex gap-2 pt-2">
                    <input type="hidden" name="projectId" value={p.id} />
                    <input
                      name="reason"
                      required
                      placeholder="Why skip the fraud pass?"
                      className="flex-1 rounded border px-2 py-1 text-sm"
                    />
                    <button type="submit" className="rounded border px-3 py-1 text-sm">
                      Skip to final review
                    </button>
                  </form>
                )}
              </Card>
            )}

            {isFinalStage && p.joe_outcome === "rejected" && (
              <Card className="p-5 text-sm gap-0 ring-rose-300 dark:ring-rose-500/30 text-rose-700 dark:text-rose-300">
                <strong>Joe rejected this on fraud review.</strong>{" "}
                {p.joe_reason || "No reason given."} You can still approve it, but document
                why in your notes.
              </Card>
            )}

            {ageFlag && (
              <Card className="p-4 text-sm gap-1 ring-amber-300 dark:ring-amber-500/30">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  Age eligibility
                </div>
                <div className="text-xs text-muted-foreground">
                  This submitter turns 19 between shipping this project and now , Hack
                  Club's YSWS guidelines want an Override Age Justification documented
                  before deciding. See the audit note below.
                </div>
              </Card>
            )}

            {isOwn && p.status === "shipped" && (
              <Card className="p-5 text-sm gap-0 ring-amber-300 dark:ring-amber-500/30 text-amber-700 dark:text-amber-300">
                This is your own submission , another reviewer has to do the first pass.
              </Card>
            )}
            {isOwn && isFinalStage && canReview && (
              <Card className="p-4 text-xs gap-0 ring-amber-300 dark:ring-amber-500/30 text-amber-700 dark:text-amber-300">
                Your own submission , someone else first-passed it, so you may finalize. This is
                logged.
              </Card>
            )}

            {canReview ? (
              <>
                <Card className="p-5 gap-0">
                  <div className="text-sm font-semibold mb-1">
                    {isFinalStage ? "Final pass" : "First pass"}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {isFinalStage
                      ? "Approving credits pixels at the player's level rate ($4–6/hr in px) and ships it. Every verdict needs a note. You can only lower the credited hours."
                      : "Every verdict needs a note. Approving sends this to a final reviewer before pixels are credited , even you have final-reviewer rights, your own first look is still just a proposal. You can only lower the credited hours."}
                  </p>
                  <ReviewForm
                    projectId={p.id}
                    repoUrl={p.repo_url}
                    demoUrl={p.demo_url}
                    claimedHours={hours}
                    defaultHours={formDefaultHours}
                    secondPass={isFinalStage}
                    bounties={bounties}
                    trial={
                      trial?.name ? { name: trial.name, minHours: trial.min_hours ?? null } : null
                    }
                    hackatimeProjects={hackatimeProjects}
                    hackatimeSeconds={p.hackatime_seconds ?? 0}
                    ageFlag={ageFlag}
                    collaborators={collaboratorHours}
                    tier={Number(p.level) || 1}
                    playerReBefore={playerReBefore}
                    currentName={p.name}
                    currentDescription={p.description}
                    currentImageUrl={p.image_url}
                    firstPass={
                      firstPassAudit
                        ? {
                            technicalFeatures: firstPassAudit["TECHNICAL FEATURES"],
                            hackatimeEvidence: firstPassAudit["HACKATIME EVIDENCE"],
                            deflationReason: firstPassAudit["DEFLATION REASON"],
                            ageJustification: firstPassAudit["AGE JUSTIFICATION"],
                            notes: firstPassAudit["NOTES"],
                            note: p.first_pass_note,
                          }
                        : undefined
                    }
                  />
                </Card>

                <details className="rounded-xl bg-card ring-1 ring-border p-4 text-card-foreground">
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-foreground select-none list-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    Extend hours cutoff
                  </summary>
                  <p className="text-xs text-muted-foreground mt-2">
                    Normally only hours from {hackatimeCutoffLabel} onward count. If this project
                    genuinely started earlier and paused (verify against Hackatime&apos;s first-activity
                    date above), pick how far back to count from , this re-pulls their Hackatime
                    spans and raises the credited total, it never lowers it.
                  </p>
                  <form action={extendHoursCutoff} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={p.id} />
                    <Input
                      type="date"
                      name="since"
                      required
                      max={maxExtendDateStr}
                      defaultValue={
                        p.hours_extended_since
                          ? new Date(p.hours_extended_since).toISOString().slice(0, 10)
                          : undefined
                      }
                    />
                    <Textarea
                      name="note"
                      required
                      rows={2}
                      placeholder="Why count from this date (internal, not shown to the player)…"
                      className="text-sm resize-y"
                    />
                    <PendingButton
                      variant="secondary"
                      pendingText="Extending…"
                      confirm="Recount this project's hours from that date? This only ever raises the credited total."
                    >
                      Extend cutoff
                    </PendingButton>
                  </form>
                </details>

                {isFinalStage && (
                <details className="rounded-xl bg-card ring-1 ring-violet-300 dark:ring-violet-500/30 p-4 text-card-foreground">
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-violet-700 dark:text-violet-400 select-none list-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-600" />
                    Send back to first pass
                  </summary>
                  <p className="text-xs text-muted-foreground mt-2">
                    Not confident enough to confirm or overturn the first pass yourself? Send it back
                    to the front of the queue for a fresh first-pass look instead , no verdict, no
                    pixels credited yet. The first-pass reviewer is still paid in full unless you
                    flag it as their mistake below.
                  </p>
                  <form action={sendBackToFirstPass} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={p.id} />
                    <Textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Why send this back (internal, not shown to the player)…"
                      className="text-sm resize-y"
                    />
                    <Label className="flex items-start gap-2 text-sm py-0.5 font-normal">
                      <Checkbox name="voidPayout" value="1" className="mt-0.5" />
                      <span>
                        This was the first-pass reviewer&apos;s mistake , void their pending payout
                        instead of paying it in full
                      </span>
                    </Label>
                    <PendingButton
                      className="bg-violet-700 text-white border-transparent hover:bg-violet-800"
                      pendingText="Sending back…"
                      confirm="Send this back to first pass?"
                    >
                      Send back to first pass
                    </PendingButton>
                  </form>
                </details>
                )}

                {canModerate && (
                <details className="rounded-xl bg-card ring-1 ring-rose-300 dark:ring-rose-500/30 p-4 text-card-foreground">
                  <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-rose-700 dark:text-rose-400 select-none list-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                    Ban project , permanent
                  </summary>
                  <p className="text-xs text-muted-foreground mt-2">
                    Permanently bans this project , it can never be shipped again and is hidden
                    everywhere. Different from requesting changes. Reversible by staff only.
                  </p>
                  <form action={banProject} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="projectId" value={p.id} />
                    <input type="hidden" name="returnTo" value={`/review/${p.id}`} />
                    <Textarea
                      name="reason"
                      required
                      rows={2}
                      placeholder="Reason for the ban (shown to the owner)…"
                      className="text-sm resize-y"
                    />
                    <PendingButton
                      className="bg-rose-800 text-white border-transparent hover:bg-rose-900"
                      pendingText="Banning…"
                      confirm="Permanently ban this project? It can never be shipped again."
                    >
                      Ban project
                    </PendingButton>
                  </form>
                </details>
                )}
              </>
            ) : isOwn ? null : isFinalStage ? (
              <Card className="p-5 text-sm text-muted-foreground">
                Passed the first review , waiting on a final reviewer to sign off before pixels are
                credited.
              </Card>
            ) : (
              <Card className="p-5 text-sm text-muted-foreground">
                Already reviewed ,{" "}
                <StatusBadge status={p.status} />. See the{" "}
                <Link href={`/projects/${p.id}`} className="text-brand hover:underline">
                  project page
                </Link>{" "}
                to revert or take further action.
              </Card>
            )}
          </div>
        </aside>
      </div>

      {/* sticky nav bar */}
      <div className="sticky bottom-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 border-t border-border bg-background/90 backdrop-blur flex items-center gap-4">
        <Button asChild variant="outline" size="sm" className={prev ? "" : "pointer-events-none opacity-40"}>
          <Link href={prev ? `/review/${prev.id}` : "#"} prefetch={false}>
            ← Prev
          </Link>
        </Button>
        <div className="flex-1 text-center text-sm text-muted-foreground tabular-nums">
          {idx >= 0 ? `Submission ${idx + 1} of ${queue.length}` : "Not in queue"}
        </div>
        <Button asChild variant="outline" size="sm" className={next ? "" : "pointer-events-none opacity-40"}>
          <Link href={next ? `/review/${next.id}` : "#"} prefetch={false}>
            Next →
          </Link>
        </Button>
      </div>
    </div>
  );
}
