/* eslint-disable @next/next/no-img-element */
import { Fragment, Suspense, type ReactNode } from "react";
import { precheckView, type PrecheckView } from "@/lib/precheck";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePage, requireGuidelinesAck } from "@/lib/guard";
import { decryptPII } from "@/lib/crypto";
import { builderDetailsView, builderNameFor, canSeeBuilderPII } from "@/lib/reviewAccess";
import {
  getProject,
  listShippedProjects,
  listSecondReviewProjects,
  claimReview,
  firstPassAccess,
  turnedNineteenSinceShipping,
  listCollaboratorsForProject,
  lifetimeRe,
  getFirstPassAuditNote,
  listProjectNotes,
} from "@/lib/db";
import { parseAuditNote } from "@/lib/auditNote";
import { fetchCommits, attachCommitStats } from "@/lib/commits";
import { fetchBomRows } from "@/lib/bom";
import { fetchUserSpans, attachTrackedTime, fetchTrustFactor, fetchHackatimeReport } from "@/lib/hackatime";
import { yswsShipsFor } from "@/lib/ysws";
import { renderMarkdown } from "@/lib/markdown";
import { computeClaimedHours, round1 } from "@/lib/hours";
import { isSafeUrl } from "@/lib/safeUrl";
import { db } from "@/lib/db";
import { ReviewForm, type BountyOption } from "@/app/_components/ReviewForm";
import { FRAUD_SCORE_THRESHOLD as ROBERT_FRAUD_THRESHOLD } from "@/lib/robertOutcome";
import { BlackoutBadge } from "@/app/_components/BlackoutBadge";
import { BlackoutSummary } from "@/app/_components/BlackoutSummary";
import type { BlackoutReviewData } from "@/app/_components/BlackoutReviewSection";
import { getBlackoutEntry } from "@/lib/operations";
import { isBlackoutReviewable } from "@/lib/operationsReview";
import {
  banProject,
  setProjectLevel,
  extendHoursCutoff,
  sendBackToFirstPass,
  unshipProject,
  toggleProjectPeak,
  holdReview,
  releaseReviewHold,
  updateFundingAmount,
  skipRobertPass,
  submitHardwareToRobert,
  resendToRobert,
} from "@/app/actions";
import { DoubleDipBanner } from "@/app/_components/DoubleDipBanner";
import { ReviewPipelineSteps } from "@/app/_components/ReviewPipelineSteps";
import { SecondPassChecklist } from "@/app/_components/SecondPassChecklist";
import { hackatimeCutoffUnix, hackatimeCutoffLabel } from "@/app/_generated/config";
import { ReviewDetailTabs } from "@/app/_components/ReviewDetailTabs";
import { ReviewSplit } from "./ReviewSplit";
import { ReviewShortcuts } from "./ReviewShortcuts";
import { MobileReviewButton, MobileReviewSheetHeader } from "./MobileReviewPanel";
import { getStaffSettings } from "@/lib/db";
import { ReviewHeartbeat } from "@/app/_components/ReviewHeartbeat";
import { ProjectNotes } from "@/app/_components/ProjectNotes";
import { LevelBadge, TypeBadge, ShipBadges, StatusBadge, BeaconBadge, FundingBadge } from "@/app/_components/ProjectBadges";
import { FraudyAiSummary } from "@/app/_components/FraudyAiSummary";
import { fraudyCheckAi, type FraudyAiCheck } from "@/lib/fraudy";
import { CardSkeleton } from "@/app/_components/Loading";
import { slackHandle } from "@/lib/slack";
import { getLiveMode, getHideReviewers } from "@/lib/liveModeServer";
import { ShowReviewerNames } from "@/app/_components/ShowReviewerNames";
import { liveAlias, redactBuilderDetails, reviewerName } from "@/lib/liveMode";
import { unshipWarning } from "@/lib/unship";
import {
  ActionButton,
  Avatar,
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  CountBadge,
  DescriptionList,
  Details,
  EmptyState,
  Field,
  Flash,
  Icon,
  Input,
  Mono,
  Muted,
  NativeSelect,
  Table,
  TextLink,
  Textarea,
  buttonClass,
  formatDate,
  formatDateTime,
  type GlyphName,
  type Tone,
} from "@/app/_ui/ui";
import Tabs from "@/app/_ui/Tabs";
import { Await } from "./Await";

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

function trustTone(level: string): Tone {
  if (level === "green") return "success";
  if (level === "red" || level === "convicted") return "danger";
  if (level === "yellow" || level === "suspected") return "warning";
  return "neutral";
}

function trustText(level: string): string {
  if (level === "green") return "No fraud flags on this account.";
  if (level === "red" || level === "convicted")
    return "Hackatime has convicted this account of fraud. Do not credit without digging.";
  if (level === "yellow" || level === "suspected") return "Hackatime suspects this account. Verify carefully.";
  return "Not scored yet.";
}

// A titled block of free text the builder (or the system) attached to the ship.
function NoteCallout({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warning" | "danger" | "info" | "success" | "neutral";
  icon: GlyphName;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Callout tone={tone} icon={icon}>
      <p className="font-bold">{title}</p>
      <div className="mt-1 whitespace-pre-wrap break-words">{children}</div>
    </Callout>
  );
}

const HOURS_COLOR = { hackatime: "var(--hc-blue)", journals: "#e0701f" };

const VOID_PAYOUT_LABEL =
  "This was the first-pass reviewer's mistake. Void their payout and take the pixels back instead of keeping it.";

export default async function ReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const access = await requirePage("reviewer");
  await requireGuidelinesAck(access);
  const viewer = access.session.slackId;
  const canSecondPass = access.canSecondPass;
  // Only admins (ban perm) may permanently ban a project from the review page.
  const canModerate = access.isOwner;
  // Gates the "AI time" tab: owner or second-pass reviewer, either stage.
  const canViewAiTime = access.isOwner || canSecondPass;
  const { id } = await params;
  const { error } = await searchParams;
  const projectId = Number(id);
  if (!Number.isFinite(projectId)) notFound();
  // Live mode (screen-share safe): builder identity is swapped out here on the
  // server, so none of it reaches the browser. See lib/liveMode.ts.
  const live = await getLiveMode();
  // While live, other reviewers' names are "Reviewer" unless revealed with
  // the Show reviewer names button (the viewer's own name always shows).
  const hideReviewers = await getHideReviewers();
  const staffSettings = await getStaffSettings(access.session.slackId);
  const rn = (label: string | null | undefined, fallback?: string) =>
    reviewerName(label, viewer, hideReviewers, fallback);

  const [data, allCollaborators, blackoutEntry, notes] = await Promise.all([
    getProject(projectId),
    listCollaboratorsForProject(projectId),
    getBlackoutEntry(projectId),
    listProjectNotes(projectId),
  ]);
  if (!data) notFound();
  const { project: p, journals, reviewAudits } = data;
  // A reviewer restricted to one queue can't open a project from the other.
  // Treat it the same as a missing project rather than exposing that it exists.
  if (access.reviewQueues !== "both" && p.kind !== access.reviewQueues) notFound();
  // Fraud review and Spot check (second pass) belong to final reviewers, fraud
  // reviewers and owners. A normal reviewer gets the same "not found" as a
  // missing project, so Robert's score and notes never reach them.
  if ((p.status === "fraud_review" || p.status === "second_review") && !access.canFraudReview) notFound();
  // First pass: a plain reviewer can only open the first page of the queue and
  // the projects assigned to them (owners exempt). The queue greys the rest
  // out, this covers someone typing the URL. See lib/reviewAssignment.ts.
  if (p.status === "shipped" && !access.isOwner) {
    const gate = await firstPassAccess(projectId, viewer, false);
    if (!gate.ok) redirect(`/review?error=${encodeURIComponent(gate.message)}`);
  }
  // The Trial this project was shipped for, if the player flagged one at ship
  // time (joined in getProject). null = they built their own idea.
  const trial = (
    p as {
      sidequests?: {
        name?: string;
        region?: string;
        reward?: string;
        min_hours?: number | null;
        description?: string | null;
        brief?: string | null;
      } | null;
    }
  ).sidequests;
  // What the Trial asks the player to build: the brief (the full rules shown
  // after they accept it), falling back to the short description.
  const trialRules = (trial?.brief || trial?.description || "").trim();

  const isFinalStage = p.status === "second_review";
  // A first-pass reviewer proposing a ban skips Robert entirely: it goes
  // straight to a full ReviewForm confirm/overturn by a different
  // canSecondPass reviewer (see the isProposedBan gate in reviewProject,
  // app/actions.ts), never through fraud review.
  const isProposedBan = isFinalStage && p.first_pass_verdict === "banned";
  // A project only reaches second_review once Robert's score has landed,
  // carrying second_pass_verdict "not_fraud" with it (see robertSync.ts), so
  // the spot check is the only thing isFinalStage can mean besides a proposed ban.
  const spotCheckStage = isFinalStage && p.second_pass_verdict === "not_fraud";
  // Owner of the project, or a collaborator on it, pending invites included
  // (all are paid on approval, so none may review it, owners included).
  // Mirrors isOwnProject in app/actions.ts.
  const isOwn =
    (!!p.users?.slack_id && p.users.slack_id === viewer) ||
    allCollaborators.some(
      (c) => (c.status === "accepted" || c.status === "pending") && !!c.users?.slack_id && c.users.slack_id === viewer,
    );
  const isHeld = !!p.hold_at;
  // hold_by is stored as "Name (SlackID)" (see holdReview in app/actions.ts).
  // Only the reviewer who set it (or an owner) may release it.
  const heldByMe = isHeld && p.hold_by?.match(/\(([^)]+)\)\s*$/)?.[1] === viewer;
  const canReview =
    !isHeld &&
    !p.banned_at &&
    ((p.status === "shipped" && !isOwn) ||
      (isProposedBan && canSecondPass && !isOwn) ||
      (spotCheckStage && (access.isOwner || canSecondPass) && !isOwn));
  // Reviewer-side unship (see unshipProject): available to final reviewers at
  // second pass or fraud review regardless of who could submit a verdict, and
  // never on your own project or while a hold is set.
  const unshipNote = canSecondPass && !isOwn && !isHeld ? unshipWarning(p.status) : null;
  const shippedAt = (p as { shipped_at?: string | null }).shipped_at ?? null;

  const [claim, playerReBefore, firstPassAuditNote, bountyEventsResult] = await Promise.all([
    canReview ? claimReview(projectId, viewer) : Promise.resolve({ ok: true as const, by: undefined }),
    // The RE the player already holds, excluding this project. It sets the
    // rate they'll be paid at, so the reviewer sees it before deciding.
    lifetimeRe(p.user_id, projectId),
    // So the final reviewer starts from what the first reviewer already wrote
    // instead of a blank form. They can still edit or overturn any of it.
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

  // ---- Slow external lookups. Started here, never awaited by the page itself:
  // each one streams into its own <Suspense> boundary below, so GitHub,
  // Hackatime, the YSWS archive and Slack can't hold up the reviewer's view.
  const hackatimeProjects = p.hackatime_projects ?? [];
  // Promise.resolve turns the query builder's thenable into a real promise,
  // so the token query runs once even though two lookups await it.
  const tokenPromise: Promise<string | null> = hackatimeProjects.length
    ? Promise.resolve(
        db
          .from("users")
          .select("hackatime_token")
          .eq("id", p.user_id)
          .single()
          .then((r) => (r.data as { hackatime_token?: string } | null)?.hackatime_token ?? null),
      )
    : Promise.resolve(null);
  // Commit stats and tracked time both mutate the same result, so they run as
  // one chain alongside everything else.
  const commitsPromise = (async () => {
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
  // Fraudy's own human/AI split per linked Hackatime project, for the AI time
  // tab. Skipped in live mode (no real Hackatime id to send) and for viewers
  // who can't see that tab anyway, since every call is logged under the
  // Fraudy key's owner.
  const fraudyChecksPromise: Promise<Record<string, FraudyAiCheck | null>> =
    !live && canViewAiTime
      ? hackatimeReportPromise.then(async (report) => {
          if (!report?.ok || !report.hackatimeUserId) return {};
          const linked = report.projects.filter((hp) => hp.linked);
          const entries = await Promise.all(
            linked.map(async (hp) => [hp.name, await fraudyCheckAi(report.hackatimeUserId, hp.name)] as const),
          );
          return Object.fromEntries(entries);
        })
      : Promise.resolve({});
  const trustPromise = fetchTrustFactor(p.users?.slack_id);
  const yswsPromise = yswsShipsFor(p.users?.slack_id, p.repo_url, p.demo_url);
  const ownerHandlePromise = slackHandle(p.users?.slack_id);
  const bomPromise = p.needs_funding && p.bom_url ? fetchBomRows(p.bom_url) : null;
  const claimByShown = !claim.ok && !!claim.by && rn(claim.by) !== "Reviewer";
  const claimHandlePromise = claimByShown ? slackHandle(claim.by) : null;
  // includeClaimed so prev/next and the "Submission N of M" counter walk the
  // same queue the list page shows. nextReviewId (the auto-advance after a
  // verdict) deliberately keeps excluding them, since it picks work for you.
  const queuePromise = isFinalStage
    ? listSecondReviewProjects(viewer, undefined, { includeClaimed: true })
    : listShippedProjects(viewer, undefined, { includeClaimed: true });

  // approved_hours is a reviewer's per-entry deflation set from the Journals
  // tab (see setJournalHours in app/actions.ts). null means "use the player's
  // own claimed hours for this entry". Every total below derives from it, so
  // deflating one entry changes the whole page's totals.
  const sumHours = (rows: typeof journals, approved: boolean) =>
    round1(rows.reduce((s, j) => s + (Number(approved ? (j.approved_hours ?? j.hours) : j.hours) || 0), 0));
  const ownerJournals = journals.filter((j) => j.user_id === p.user_id);
  const journalHours = sumHours(journals, true);
  const rawTrackedHours = round1((p.hackatime_seconds ?? 0) / 3600);
  // For a hardware ship, hackatime_seconds is never pure Hackatime time: the
  // ship route folds the owner's raw journal hours into that column (see
  // 0130_project_kind.sql). Subtract that RAW owner-only sum back out, not the
  // live possibly-deflated journalHours, or a deflation edit would cancel out.
  const rawOwnerJournalHours = sumHours(ownerJournals, false);
  // The gap between raw and approved journal hours is exactly how much
  // per-entry deflation has taken off the credited total.
  const rawJournalHours = sumHours(journals, false);
  const journalDeflatedHours = Math.max(0, round1(rawJournalHours - journalHours));
  const hackatimeHours =
    p.kind === "hardware" ? Math.max(0, round1(rawTrackedHours - rawOwnerJournalHours)) : rawTrackedHours;
  // Shared claimed-hours calculator (lib/hours.ts), matching claimedHoursFor() in actions.ts.
  const hours = computeClaimedHours({
    hackatimeSeconds: p.hackatime_seconds,
    kind: p.kind,
    ownerUserId: p.user_id,
    journals,
  });
  const htPct = hours > 0 ? Math.round((hackatimeHours / hours) * 100) : 0;
  const payoutHours = hours;
  // The owner's own journal hours only, so a collaborator's time stays visible
  // on a multi-person ship.
  const ownerJournalHoursOnly = sumHours(ownerJournals, true);

  const acceptedCollaborators = allCollaborators.filter((c) => c.status === "accepted");
  const collaboratorIds = acceptedCollaborators.map((c) => c.user_id);
  const displayName = (userId: string, real: string): string =>
    live ? liveAlias(userId, p.user_id, collaboratorIds) : real;
  const collaboratorHours = acceptedCollaborators.map((c) => {
    const cJournalHours = sumHours(
      journals.filter((j) => j.user_id === c.user_id),
      true,
    );
    const cHackatimeHours = round1((c.hackatime_seconds ?? 0) / 3600);
    return {
      id: c.id,
      userId: c.user_id,
      name: displayName(c.user_id, builderNameFor(access, c.users, { fallback: c.user_id })),
      hackatimeHours: cHackatimeHours,
      journalHours: cJournalHours,
      claimedHours: cHackatimeHours > 0 ? cHackatimeHours : cJournalHours,
    };
  });
  // Legal name for owners/final reviewers only (builderNameFor); a first-pass
  // reviewer sees the Slack handle or display name.
  const ownerNameFor = (handle: string | null) =>
    displayName(p.user_id, builderNameFor(access, p.users, { handle, fallback: p.user_id }));
  const contributorsFor = (ownerName: string) => [
    { userId: p.user_id, name: ownerName, hackatimeHours, journalHours: ownerJournalHoursOnly },
    ...collaboratorHours,
  ];

  const blackoutForReview: BlackoutReviewData | null =
    isBlackoutReviewable(blackoutEntry) && blackoutEntry.firstQualifiedShipAt
      ? {
          operationName: blackoutEntry.operation.name,
          rateUsd: blackoutEntry.rateUsdSnapshot,
          rateMode: blackoutEntry.rateModeSnapshot,
          operationStartsAt: blackoutEntry.operation.startsAt,
          operationEndsAt: blackoutEntry.operation.endsAt,
          joinedAt: blackoutEntry.joinedAt,
          windowStart: blackoutEntry.windowStart,
          firstShipAt: blackoutEntry.firstQualifiedShipAt,
          reshipCount: blackoutEntry.reshipCount,
          changesRequestedAt: blackoutEntry.changesRequestedAt,
          graceDeadline: blackoutEntry.graceDeadline,
          fixWindowEnd: blackoutEntry.fixWindowEnd,
          decision: blackoutEntry.decision,
          decisionNote: blackoutEntry.decisionNote,
          decisionBy: blackoutEntry.decidedBy,
          decisionStage: blackoutEntry.decisionStage,
          trialHold:
            trial?.name && String((p as { trial_reward_choice?: string }).trial_reward_choice ?? "") !== "pixels"
              ? { name: trial.name }
              : null,
          people: blackoutEntry.contributors.map((c) => ({
            userId: c.userId,
            // Legal name for owners/final reviewers only.
            name: displayName(c.userId, canSeeBuilderPII(access) ? c.name : (c.publicName ?? "player")),
            role: c.role,
            hackatimeBaseSeconds: c.hackatimeBaseSeconds,
            journalBaseSeconds: c.journalBaseSeconds,
            fixTrackedSeconds: c.fixTrackedSeconds,
            eligibleTrackedSeconds: c.eligibleTrackedSeconds,
            evidenceOk: c.evidenceOk,
            proposedHours: c.approvedHours,
            claimedHours:
              c.role === "owner"
                ? payoutHours
                : (collaboratorHours.find((h) => h.userId === c.userId)?.claimedHours ?? null),
          })),
        }
      : null;

  // first_pass_hours is a Postgres numeric column the driver returns as a
  // string, so it has to go through Number() before any RE/level math.
  const formDefaultHours =
    spotCheckStage && p.second_pass_hours != null
      ? Number(p.second_pass_hours)
      : isFinalStage && p.first_pass_hours != null
        ? Number(p.first_pass_hours)
        : payoutHours;
  const firstPassAudit = firstPassAuditNote ? parseAuditNote(firstPassAuditNote) : null;
  const firstPassDeflated = p.first_pass_hours != null ? round1(hours - p.first_pass_hours) : 0;
  const firstPassCutPct =
    p.first_pass_hours != null && hours > 0 ? Math.round(((hours - p.first_pass_hours) / hours) * 100) : 0;

  const ageFlag = turnedNineteenSinceShipping(p.users?.birthday, shippedAt);
  const bounties: BountyOption[] = (
    (bountyEventsResult.data ?? []) as { id: number; name: string; config: Record<string, unknown> }[]
  ).map((ev) => ({
    id: ev.id,
    name: ev.name,
    reward: Number(ev.config.reward) || 0,
    description: String(ev.config.description ?? ""),
  }));

  // ---- Builder details for the eligibility check.
  // PII is encrypted at rest; decryptPII also passes legacy plaintext through.
  // In live mode nothing is decrypted at all (see redactBuilderDetails).
  // Name/email/birth date/address are for final reviewers and owners only
  // (canSeeBuilderPII); a first-pass reviewer gets the age plus "on file" /
  // "missing" per field, and for them only the birthday is even decrypted.
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
  const privileged = canSeeBuilderPII(access);
  const dec = (v: string | null | undefined) => (live ? "" : decryptPII(v) || "");
  const present = (v: string | null | undefined) => (live ? "" : v ? "x" : "");
  const pii = privileged ? dec : present;
  const birthday = dec(u?.birthday);
  const country = pii(u?.address_country);
  const builderView = builderDetailsView(access, isFinalStage, {
    fullName:
      [pii(u?.first_name), pii(u?.last_name)].filter(Boolean).join(" ") ||
      (privileged ? (u?.real_name ?? "") : present(u?.real_name)),
    email: pii(u?.email),
    birthday: privileged ? birthday : "",
    age: ageFrom(birthday),
    country,
    address: [pii(u?.address_line1), pii(u?.address_line2), pii(u?.address_city), pii(u?.address_state), pii(u?.address_postal), country]
      .filter(Boolean)
      .join(", "),
  });
  const builderDetails = redactBuilderDetails(live, {
    fullName: builderView.fullName,
    email: builderView.email,
    ageLabel: builderView.ageLabel,
    country: builderView.country,
    address: builderView.address ?? "",
  });

  // One day before the global cutoff, for the extend-hours date input's max.
  const maxExtendDateStr = new Date((hackatimeCutoffUnix - 86_400) * 1000).toISOString().slice(0, 10);
  const repoUrl = isSafeUrl(p.repo_url) ? p.repo_url : null;
  const demoUrl = isSafeUrl(p.demo_url) ? p.demo_url : null;
  const cartScreenshots = p.cart_screenshot_urls ?? [];
  const returnTo = `/review/${p.id}`;

  const claimCallout = (handle: string | null) => (
    <Callout tone="warning" icon="private">
      Heads up: {handle ?? (claimByShown ? claim.by : "another reviewer")} is already reviewing this submission.
      Avoid double-grading it.
    </Callout>
  );

  // Repo, README, demo (and Fraudy on the final pass) sit right under the
  // project description, so a reviewer reads what it is before opening it.
  const projectLinks = (
    <div className="flex flex-wrap gap-2">
      {repoUrl ? (
        <>
          {/* data-review-link lets ReviewForm record that the repo/demo was
              opened (repo_opened/demo_opened on the review audit). */}
          <span data-review-link="repo" className="contents">
            <ButtonLink href={repoUrl} external variant="outline" icon="github">
              Repo
            </ButtonLink>
            <ButtonLink href={`${repoUrl.replace(/\/$/, "")}#readme`} external variant="outline" icon="docs">
              README
            </ButtonLink>
          </span>
        </>
      ) : (
        <Badge tone="danger">No repo</Badge>
      )}
      {demoUrl ? (
        <span data-review-link="demo" className="contents">
          <ButtonLink href={demoUrl} external variant="outline" icon="link">
            Live demo
          </ButtonLink>
          <TypeBadge type={p.project_type} />
        </span>
      ) : (
        <Badge tone="danger">No demo</Badge>
      )}
      {/* Final pass only: Fraudy checks a Hackatime user's heartbeats for
          AI-written code. One button per linked Hackatime project so
          ?project= opens that project, or a single unscoped link to the
          user when none is linked. */}
      {!live && isFinalStage && (
        <Suspense fallback={null}>
          <Await promise={hackatimeReportPromise}>
            {(report) => {
              if (!report?.hackatimeUserId) return null;
              const fraudyUrl = (projectName?: string) => {
                const url = new URL(`https://fraudy.hackclub.com/users/${encodeURIComponent(String(report.hackatimeUserId))}`);
                if (projectName) url.searchParams.set("project", projectName);
                return url.toString();
              };
              const linked = report.projects.filter((hp) => hp.linked);
              if (linked.length === 0) {
                return (
                  <ButtonLink href={fraudyUrl()} external icon="view">
                    froud frad fraudy! is it ai?
                  </ButtonLink>
                );
              }
              return linked.map((hp) => (
                <Fragment key={hp.name}>
                  <ButtonLink href={fraudyUrl(hp.name)} external icon="view">
                    froud frad fraudy! is it ai? {hp.name}
                  </ButtonLink>
                  <Suspense fallback={null}>
                    <FraudyAiSummary hackatimeId={report.hackatimeUserId} project={hp.name} />
                  </Suspense>
                </Fragment>
              ));
            }}
          </Await>
        </Suspense>
      )}
    </div>
  );

  const ownerCard = (ownerName: string) => {
    const contributors = contributorsFor(ownerName);
    return (
      <Card padding="compact">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar src={null} size={40} />
          <div className="min-w-0 flex-1">
            <TextLink href={`/players/${p.user_id}`} className="block truncate font-bold">
              {ownerName}
            </TextLink>
            <div className="text-sm">
              {!live && p.users?.slack_id && (
                <TextLink
                  href={`https://hackclub.slack.com/team/${p.users.slack_id}`}
                  external
                  className="inline-flex items-center gap-1"
                >
                  <Icon glyph="slack" size={16} />
                  <Mono>{p.users.slack_id}</Mono>
                </TextLink>
              )}
              {acceptedCollaborators.length > 0 && (
                <Muted>
                  {!live && p.users?.slack_id ? " · " : ""}with {collaboratorHours.map((c) => c.name).join(", ")}
                </Muted>
              )}
            </div>
            <p className="hc-caption mt-1 text-sm">
              Submitted {ago(p.shipped_at)} · {fmtHM(hours)} logged
              {hackatimeProjects.length > 0 && (
                <>
                  {" · "}
                  <a href="#hackatime" className="hc-link">
                    Hackatime: {hackatimeProjects.join(", ")}
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        {acceptedCollaborators.length > 0 && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="hc-eyebrow mb-2">Time by contributor</p>
            <DescriptionList
              items={contributors.map((c) => [
                c.name,
                <Mono key={c.userId}>
                  {fmtHM(c.hackatimeHours)} Hackatime · {fmtHM(c.journalHours)} journals
                </Mono>,
              ])}
            />
            <p className="hc-caption mt-2 text-xs">
              Journal entries are labelled by who wrote them, and each commit in the Commits tab shows its own author.
            </p>
          </div>
        )}
        <details className="mt-3 border-t border-[var(--border)] pt-3">
          <summary className="hc-caption inline-flex cursor-pointer items-center gap-1 text-sm">
            <Icon glyph="checkmark" size={16} />
            Eligibility check and builder details
          </summary>
          <ul className="hc-caption mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>
              <strong>Not</strong> a school assignment, and <strong>not</strong> built as paid Hack Club work. Both are
              ineligible for the unified database.
            </li>
            <li>Repo has a usable README and the live demo actually works.</li>
          </ul>
          <p className="hc-eyebrow mb-2 mt-4">
            {builderView.privileged ? "Builder details (name, email, age, shipping)" : "Builder details (age, fields on file)"}
          </p>
          <DescriptionList
            items={[
              ["Name", builderDetails.fullName],
              ["Email", builderDetails.email],
              ["Age", builderDetails.ageLabel],
              ["Country", builderDetails.country],
              ...(builderView.address !== null
                ? ([["Address", builderDetails.address]] as [ReactNode, ReactNode][])
                : []),
            ]}
          />
        </details>
      </Card>
    );
  };

  // ---- Right column tabs.

  // Beacon sits next to the verdict: reviewers decide it while grading.
  // toggleProjectPeak re-checks the reviewer role and own-project rule.
  const beaconCard = !isOwn && (
    <Card
      padding="compact"
      className="border-[color-mix(in_srgb,var(--hc-yellow)_45%,var(--border))] bg-[color-mix(in_srgb,var(--hc-yellow)_7%,var(--surface))]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--hc-yellow)_18%,transparent)] text-[var(--hc-yellow)]">
          <Icon glyph="rep" size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="hc-heading text-sm">Beacon</p>
            {p.is_peak ? <Badge tone="yellow">Active</Badge> : <Badge>Not nominated</Badge>}
          </div>
          <form action={toggleProjectPeak}>
            <input type="hidden" name="projectId" value={p.id} />
            {!p.is_peak && <input type="hidden" name="isPeak" value="1" />}
            <ActionButton
              size="sm"
              variant={p.is_peak ? "outline" : "cream"}
              icon={p.is_peak ? undefined : "rep"}
              pendingLabel={p.is_peak ? "Removing..." : "Marking..."}
            >
              {p.is_peak ? "Remove" : "Mark Beacon"}
            </ActionButton>
          </form>
        </div>
      </div>
      <p className="hc-caption mt-2 text-xs">
        A standout project. Every live Beacon earns its maker one unlock for a Beacon-locked shop reward. Cosmetic on
        the project itself and never affects payout.
      </p>
      {p.is_peak && (
        <p className="hc-caption mt-2 text-xs">
          <strong>This project is a Beacon.</strong> Its unlock is ready to spend unless the maker already used it.
        </p>
      )}
    </Card>
  );

  const reviewTab = (
    <div className="flex flex-col gap-4 pt-4">
      {blackoutEntry && !blackoutForReview && blackoutEntry.status !== "entered" && (
        <BlackoutSummary entry={blackoutEntry} />
      )}
      {canReview ? (
        <>
          {spotCheckStage && p.robert_trust_score != null && (
            <Card padding="compact">
              <h3 className="hc-heading text-base">Robert fraud review</h3>
              <p className="hc-caption mt-1 text-sm">
                Trust score <Mono>{p.robert_trust_score}/10</Mono>
                {p.robert_trust_score <= ROBERT_FRAUD_THRESHOLD ? ", in Robert's \"Fraud\" range" : ""}
              </p>
              {p.robert_note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{p.robert_note}</p>}
              {canSecondPass && (
                <form action={resendToRobert} className="mt-3">
                  <input type="hidden" name="projectId" value={p.id} />
                  <ActionButton
                    variant="outline"
                    size="sm"
                    pendingLabel="Sending..."
                    confirm="Delete Robert's review and send this project back to Robert? It leaves Spot check until his new review comes back. If Robert doesn't accept it, the old review is kept."
                  >
                    Delete and resend to Robert
                  </ActionButton>
                </form>
              )}
            </Card>
          )}
          {spotCheckStage && p.kind === "hardware" && !p.robert_project_id && p.robert_trust_score == null && canSecondPass && (
            <Card padding="compact">
              <h3 className="hc-heading text-base">Robert fraud review</h3>
              <p className="hc-caption mt-1 text-sm">
                Hardware projects are not sent to Robert automatically. Send this one if you want a fraud review.
              </p>
              <form action={submitHardwareToRobert} className="mt-3">
                <input type="hidden" name="projectId" value={p.id} />
                <ActionButton
                  variant="outline"
                  size="sm"
                  pendingLabel="Submitting..."
                  confirm="Submit this hardware project to Robert? It leaves Spot check until Robert's review comes back."
                >
                  Submit to Robert
                </ActionButton>
              </form>
            </Card>
          )}
          <Card>
            <h3 className="hc-heading text-base">
              {isProposedBan ? "Final pass" : spotCheckStage ? "Spot check" : "First pass"}
            </h3>
            <p className="hc-caption mt-1 mb-4 text-sm">
              {isProposedBan
                ? "A first-pass reviewer proposed banning this. Confirm it, or approve to overturn. Approving credits pixels at the player's level rate ($4-6/hr in px) and ships it. Every verdict needs a note. You can only lower the credited hours."
                : spotCheckStage
                  ? "The real final verdict, after Robert's fraud review. Approving credits pixels at the player's level rate ($4-6/hr in px) and ships it. Every verdict needs a note. You can only lower the credited hours."
                  : "Every verdict needs a note. Approving sends this to Robert for fraud review before pixels are credited, so even with final-reviewer rights your first look is still a proposal. You can only lower the credited hours."}
            </p>
            <ReviewForm
              projectId={p.id}
              repoUrl={p.repo_url}
              demoUrl={p.demo_url}
              claimedHours={payoutHours}
              defaultHours={formDefaultHours}
              journalDeflatedHours={journalDeflatedHours}
              isSuper={access.isOwner}
              canAiDraft={access.canAiDraft}
              canEditSubmission={access.canEditSubmission}
              secondPass={spotCheckStage || isProposedBan}
              bounties={bounties}
              trial={trial?.name ? { name: trial.name, minHours: trial.min_hours ?? null } : null}
              ageFlag={ageFlag}
              collaborators={collaboratorHours}
              blackout={blackoutForReview}
              tier={Number(p.level) || 1}
              playerReBefore={playerReBefore}
              fundingUsd={p.needs_funding ? Number(p.funding_usd ?? 0) : 0}
              currentName={p.name}
              currentDescription={p.description}
              currentImageUrl={p.image_url}
              defaultRevealName={staffSettings.reviewRevealName}
              defaultNotifyOnResubmit={staffSettings.reviewNotifyOnResubmit}
              firstPass={
                firstPassAudit
                  ? {
                      technicalFeatures: firstPassAudit["TECHNICAL FEATURES"],
                      deflationReason: firstPassAudit["DEFLATION REASON"],
                      ageJustification: firstPassAudit["AGE JUSTIFICATION"],
                      notes: firstPassAudit["NOTES"],
                      note: p.first_pass_note,
                    }
                  : undefined
              }
              serverDraft={
                p.review_draft ? { draft: p.review_draft, by: p.review_draft_by, at: p.review_draft_at } : undefined
              }
            />
          </Card>
        </>
      ) : p.banned_at ? (
        <Callout tone="danger" icon="important">
          <strong>This project was banned{p.ban_by ? ` by ${p.ban_by}` : ""} on {formatDateTime(p.banned_at)}.</strong>{" "}
          It can't be reviewed anymore and can never be shipped again.
          {p.ban_reason && <span className="mt-1 block whitespace-pre-wrap break-words">Reason: {p.ban_reason}</span>}
        </Callout>
      ) : isOwn ? (
        <EmptyState title="Your own submission" icon="private">
          Someone else has to review it.
        </EmptyState>
      ) : p.status === "fraud_review" ? (
        <Card>
          <p className="text-sm">
            Passed the first review and waiting on Robert&apos;s fraud review. Nothing to action here until it comes
            back.
          </p>
          {p.robert_error && (
            <div className="mt-3">
              <Callout tone="danger" icon="important">
                Last submission to Robert failed: {p.robert_error}. The reconcile job will retry it.
              </Callout>
            </div>
          )}
          {canSecondPass && (
            <form action={skipRobertPass} className="mt-3">
              <input type="hidden" name="projectId" value={p.id} />
              <ActionButton
                variant="outline"
                size="sm"
                pendingLabel="Skipping..."
                confirm="Skip Robert's fraud review and send this project straight to Spot check?"
              >
                Skip Robert pass
              </ActionButton>
            </form>
          )}
        </Card>
      ) : isFinalStage ? (
        <Callout tone="neutral" icon="clock">
          Passed the first review. Waiting on a final reviewer to sign off before pixels are credited.
        </Callout>
      ) : (
        <Callout tone="neutral" icon="checkmark">
          <span className="inline-flex flex-wrap items-center gap-2">
            Already reviewed <StatusBadge status={p.status} />
          </span>
          <p className="mt-1">
            See the{" "}
            <TextLink href={`/projects/${p.id}`} className="font-bold">
              project page
            </TextLink>{" "}
            to revert or take further action.
          </p>
        </Callout>
      )}
      {beaconCard}
    </div>
  );

  const actionsTab = (
    <div className="flex flex-col gap-4 pt-4">
      {!isOwn && (
        <Card padding="compact">
          <form action={setProjectLevel} className="flex items-end gap-2">
            <input type="hidden" name="projectId" value={p.id} />
            <Field label="Re-grade tier" className="flex-1">
              <NativeSelect name="level" defaultValue={p.level ?? 1}>
                <option value={1}>T1 · Spark</option>
                <option value={2}>T2 · Signal</option>
                <option value={3}>T3 · Grid</option>
                <option value={4}>T4 · Nexus</option>
              </NativeSelect>
            </Field>
            <ActionButton variant="outline" pendingLabel="Saving...">
              Set
            </ActionButton>
          </form>
        </Card>
      )}

      {!isHeld && (
        <Details summary="Put this review on hold">
          <form action={holdReview} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={p.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="hc-caption text-sm">
              Blocks any verdict on this project until you or an admin releases it, e.g. mid-investigation. It stays
              visible in the queue.
            </p>
            <Textarea name="reason" required rows={2} placeholder="Why hold this (internal, not shown to the player)..." />
            <ActionButton
              variant="outline"
              pendingLabel="Holding..."
              confirm="Hold this review? Nobody can submit a verdict on it until you or another owner releases it."
            >
              Hold this review
            </ActionButton>
          </form>
        </Details>
      )}


      {canReview && (
        <Details summary="Extend hours cutoff">
          <form action={extendHoursCutoff} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={p.id} />
            <p className="hc-caption text-sm">
              Normally only hours from {hackatimeCutoffLabel} onward count. If this project genuinely started earlier
              and paused (verify against Hackatime&apos;s first-activity date), pick how far back to count from. This
              re-pulls their Hackatime spans and raises the credited total, it never lowers it.
            </p>
            <Input
              type="date"
              name="since"
              required
              max={maxExtendDateStr}
              defaultValue={
                p.hours_extended_since ? new Date(p.hours_extended_since).toISOString().slice(0, 10) : undefined
              }
            />
            <Textarea
              name="note"
              required
              rows={2}
              placeholder="Why count from this date (the player will see this in a DM)..."
            />
            <ActionButton
              variant="outline"
              pendingLabel="Extending..."
              confirm="Recount this project's hours from that date? This only ever raises the credited total."
            >
              Extend cutoff
            </ActionButton>
          </form>
        </Details>
      )}

      {canReview && isFinalStage && (
        <Details summary="Send back to first pass">
          <form action={sendBackToFirstPass} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={p.id} />
            <p className="hc-caption text-sm">
              Not confident enough to confirm or overturn the first pass yourself? Send it back to the front of the
              queue for a fresh first-pass look instead. No verdict, no pixels credited yet. The first-pass reviewer
              is still paid in full unless you flag it as their mistake below.
            </p>
            <Textarea
              name="reason"
              required
              rows={2}
              placeholder="Why send this back (internal, not shown to the player)..."
            />
            <Checkbox name="voidPayout" value="1" label={VOID_PAYOUT_LABEL} />
            <ActionButton variant="cream" pendingLabel="Sending back..." confirm="Send this back to first pass?">
              Send back to first pass
            </ActionButton>
          </form>
        </Details>
      )}

      {unshipNote && (
        <Details summary="Unship to draft">
          <form action={unshipProject} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={p.id} />
            <p className="hc-caption text-sm">
              Takes this out of the queue and hands it back to the owner as an editable draft. They fix it and
              reship, and review starts from scratch: the first-pass verdict (including a ban proposal), notes and
              second-pass checklist are all cleared. The owner and any collaborators are notified with your reason.
            </p>
            <Callout tone="warning" icon="important">
              {unshipNote}
            </Callout>
            <Textarea name="reason" required rows={2} placeholder="Why unship this (shown to the owner)..." />
            <Checkbox name="voidPayout" value="1" label={VOID_PAYOUT_LABEL} />
            <ActionButton
              variant="danger"
              pendingLabel="Unshipping..."
              confirm={`${unshipNote}\n\nUnship this project back to a draft? The owner is notified and it leaves the queue.`}
            >
              Unship to draft
            </ActionButton>
          </form>
        </Details>
      )}

      {canReview && canModerate && (
        <Details summary="Ban project (permanent)">
          <form action={banProject} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={p.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <p className="hc-caption text-sm">
              Permanently bans this project. It can never be shipped again and is hidden everywhere. Different from
              requesting changes. Reversible by staff only.
            </p>
            <Textarea name="reason" required rows={2} placeholder="Reason for the ban (shown to the owner)..." />
            <ActionButton
              variant="danger"
              pendingLabel="Banning..."
              confirm="Permanently ban this project? It can never be shipped again."
            >
              Ban project
            </ActionButton>
          </form>
        </Details>
      )}
    </div>
  );

  const overviewTab = (
    <div className="flex flex-col gap-4 pt-4">
      <Card>
        <p className="hc-eyebrow">Logged hours</p>
        <p className="mt-1 mb-3">
          <span className="hc-stat-value">{fmtHM(hours)}</span> <Muted className="text-sm">logged</Muted>
        </p>
        {/* Blue vs a deepened Hack Club orange: checked for colorblind
            separation and contrast on both themes (blue/purple wasn't). */}
        <div className="flex h-2 gap-0.5 rounded-full bg-[var(--sunken)]">
          {htPct > 0 && (
            <div
              className="h-full rounded-full"
              style={{ width: `${htPct}%`, background: HOURS_COLOR.hackatime }}
              title={`Hackatime: ${fmtHM(hackatimeHours)}`}
            />
          )}
          {htPct < 100 && hours > 0 && (
            <div
              className="h-full rounded-full"
              style={{ width: `${100 - htPct}%`, background: HOURS_COLOR.journals }}
              title={`Journals: ${fmtHM(journalHours)}`}
            />
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 text-sm">
          <a href="#hackatime" className="hc-link flex items-center gap-2" title="See the full Hackatime breakdown">
            <span className="hc-dot" style={{ background: HOURS_COLOR.hackatime }} />
            Hackatime
            <span className="hc-mono ml-auto">{fmtHM(hackatimeHours)}</span>
          </a>
          <div className="flex items-center gap-2">
            <span className="hc-dot" style={{ background: HOURS_COLOR.journals }} />
            Journals
            <span className="hc-mono ml-auto">{fmtHM(journalHours)}</span>
          </div>
        </div>
        {p.hours_extended_since && (
          <p className="hc-caption mt-3 border-t border-[var(--border)] pt-3 text-xs">
            Counting hours from <strong>{formatDate(p.hours_extended_since)}</strong> (before the{" "}
            {hackatimeCutoffLabel} cutoff), set by <strong>{p.hours_extended_by}</strong>: {p.hours_extended_note}
          </p>
        )}
      </Card>

      <Suspense fallback={null}>
        <Await promise={trustPromise}>
          {(trust) =>
            trust && (
              <Card padding="compact">
                <div className="flex items-center gap-3">
                  <Badge tone={trustTone(trust.level)}>{trust.level === "blue" ? "unscored" : trust.level}</Badge>
                  <span className="hc-caption text-sm">Hackatime trust factor. {trustText(trust.level)}</span>
                </div>
              </Card>
            )
          }
        </Await>
      </Suspense>

      {isFinalStage && (
        <Card>
          <CardHeader title="First pass" icon="history" />
          {p.first_pass_verdict && p.first_pass_verdict !== "approved" && (
            <div className="mb-3">
              <Callout tone="danger" icon="important">
                First reviewer proposed {p.first_pass_verdict === "banned" ? "a BAN" : "changes"}. Confirm it, or
                approve to overturn.
                {p.first_pass_verdict === "banned" && !access.isOwner && (
                  <p className="mt-1">
                    Only an owner can confirm a ban. Approving sends it back through fraud review and the owner spot
                    check.
                  </p>
                )}
              </Callout>
            </div>
          )}
          <p className="text-sm">
            {p.first_pass_verdict === "banned"
              ? "Ban proposed by "
              : p.first_pass_verdict === "needs_changes"
                ? "Changes proposed by "
                : "Passed by "}
            <strong>{rn(p.first_pass_by, "a reviewer")}</strong>
            {p.first_pass_hours != null && (
              <>
                {" "}
                · credited <Mono>{p.first_pass_hours}h</Mono> of <Mono>{hours}h</Mono> claimed
              </>
            )}
          </p>
          {firstPassDeflated > 0 && (
            <p className="mt-1 text-sm text-[var(--hc-red)]">
              Deflated {firstPassDeflated}h{firstPassCutPct > 0 ? ` (-${firstPassCutPct}%)` : ""}
            </p>
          )}
          {p.first_pass_note && (
            <div className="mt-3">
              <p className="hc-eyebrow mb-1">Their note</p>
              <p className="whitespace-pre-wrap break-words text-sm">{p.first_pass_note}</p>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Pipeline" icon="list-checked" />
        <div className="flex flex-col gap-4">
          <ReviewPipelineSteps
            shippedAt={p.shipped_at}
            firstPassAt={p.first_pass_at}
            status={p.status}
            airtableRecordId={p.airtable_record_id}
          />
          {isFinalStage && canSecondPass && (
            <SecondPassChecklist
              projectId={p.id}
              values={{
                second_pass_telescreen_checked: Boolean(p.second_pass_telescreen_checked),
                second_pass_hours_deflated: Boolean(p.second_pass_hours_deflated),
                second_pass_heartbeats_added: Boolean(p.second_pass_heartbeats_added),
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );

  const rightTabs = [
    { key: "review", label: "Review", content: reviewTab },
    { key: "actions", label: "Actions", content: actionsTab },
    { key: "overview", label: "Overview", content: overviewTab },
    {
      key: "notes",
      label: (
        <>
          Notes {notes.length > 0 && <CountBadge>{notes.length}</CountBadge>}
        </>
      ),
      content: (
        <div className="pt-4">
          <ProjectNotes projectId={p.id} notes={notes} />
        </div>
      ),
    },
  ];

  return (
    <div className="hc-review flex flex-col gap-6">
      {claim.ok && canReview && <ReviewHeartbeat projectId={projectId} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink href="/review" variant="ghost" size="sm" icon="view-back">
          Review queue
        </ButtonLink>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href={`/projects/${p.id}`} variant="outline" size="sm">
            Open in project view
          </ButtonLink>
          {live && <ShowReviewerNames hidden={hideReviewers} />}
        </div>
      </div>

      {(error || !claim.ok) && (
        <div className="flex flex-col gap-3">
          <Flash error={error} />
          {!claim.ok &&
            (claimHandlePromise ? (
              <Suspense fallback={claimCallout(null)}>
                <Await promise={claimHandlePromise}>{(handle) => claimCallout(handle)}</Await>
              </Suspense>
            ) : (
              claimCallout(null)
            ))}
        </div>
      )}

      <ReviewSplit initialWidth={staffSettings.reviewPanelWidth}>
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} />
              <LevelBadge level={p.level} />
              <TypeBadge type={p.project_type} />
              <ShipBadges project={p} />
              <FundingBadge needsFunding={p.needs_funding} fundingUsd={p.funding_usd} />
              {p.is_peak && <BeaconBadge />}
              {blackoutEntry && blackoutEntry.status !== "entered" && <BlackoutBadge />}
              {trial?.name && (
                <Badge tone="cyan">
                  Trial: {trial.name}
                  {trial.min_hours != null ? ` · min ${trial.min_hours}h` : ""}
                </Badge>
              )}
              {isHeld && (
                <Badge tone="warning" icon="private">
                  On hold
                </Badge>
              )}
              <Muted className="ml-auto text-sm">
                <Mono>#{p.id}</Mono>
              </Muted>
            </div>
            <h1 className="hc-title mt-2 break-words">{p.name}</h1>
          </div>

          {/* Who built it, when and how long: first thing a reviewer needs, so
              it sits right under the title. */}
          <Suspense fallback={ownerCard(ownerNameFor(null))}>
            <Await promise={ownerHandlePromise}>{(handle) => ownerCard(ownerNameFor(handle))}</Await>
          </Suspense>

          {p.image_url && (
            <img
              src={p.image_url}
              alt=""
              className="max-h-96 w-full rounded-lg border border-[var(--border)] bg-[var(--sunken)] object-contain"
            />
          )}

          {trial?.name && (
            <NoteCallout
              tone="info"
              icon="list-checked"
              title={
                <>
                  Trial rules: {trial.name}
                  {trial.min_hours != null ? ` (min ${trial.min_hours}h)` : ""}
                  {trial.reward ? `, reward: ${trial.reward}` : ""}
                </>
              }
            >
              {trialRules || "No rules written for this Trial."}
            </NoteCallout>
          )}

          {p.description && (
            <Card>
              <div className="hc-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.description) }} />
            </Card>
          )}

          {projectLinks}

          <DoubleDipBanner systemNote={p.system_note} />
          <PrecheckCallout view={precheckView(p)} />
          {!p.used_ai && (
            <Suspense fallback={null}>
              <Await promise={commitsPromise}>
                {(commits) => {
                  const aiCommits = commits.commits.filter((c) => c.ai).length;
                  if (aiCommits === 0) return null;
                  return (
                    <Callout tone="danger" icon="important">
                      {aiCommits} commit{aiCommits === 1 ? "" : "s"} in this repo {aiCommits === 1 ? "is" : "are"}{" "}
                      signed by an AI tool, but the maker did not tick &ldquo;AI used&rdquo;. Undisclosed AI: verify
                      before crediting.
                    </Callout>
                  );
                }}
              </Await>
            </Suspense>
          )}
          {p.is_update && Number(p.prior_approved_hours) > 0 && (
            <NoteCallout tone="warning" icon="important" title="Update ship: hours are cumulative">
              Last approval credited {round1(Number(p.prior_approved_hours))}h (with any deflation already applied). The{" "}
              {hours}h above is the whole project, so about {Math.max(round1(hours - Number(p.prior_approved_hours)), 0)}h is
              new. Enter the credited TOTAL, deflating only the new work: pixels are paid as the difference from what this
              project already earned, and the Airtable row for this update carries only the new hours.
            </NoteCallout>
          )}
          {p.is_update && p.update_notes && (
            <NoteCallout tone="info" icon="view-reload" title="What changed since last approval">
              {p.update_notes}
            </NoteCallout>
          )}
          {p.other_ysws_notes && (
            <NoteCallout tone="warning" icon="important" title="What changed since their other YSWS submission">
              {p.other_ysws_notes}
            </NoteCallout>
          )}
          {p.ship_note && (
            <Details
              open
              summary={
                <>
                  <Icon glyph="message" size={18} className="hc-muted" />
                  Note from the builder
                </>
              }
            >
              <div className="whitespace-pre-wrap break-words text-sm">{p.ship_note}</div>
            </Details>
          )}
          {p.used_ai && (
            <Details
              open
              summary={
                <>
                  <Icon glyph="code" size={18} className="hc-muted" />
                  AI declaration
                </>
              }
            >
              <div className="whitespace-pre-wrap break-words text-sm">
                {p.ai_notes || "Player ticked “AI used” but gave no details (pre-dates the details field)."}
              </div>
            </Details>
          )}

          {p.needs_funding && (
            <Card>
              <CardHeader
                title="Funding requested"
                icon="bank-account"
                action={<Badge tone="success">${Number(p.funding_usd ?? 0).toFixed(2)}</Badge>}
              />
              <div className="flex flex-col gap-4">
                <form action={updateFundingAmount} className="flex items-end gap-2">
                  <input type="hidden" name="projectId" value={p.id} />
                  <Field label="Correct amount ($)">
                    <Input
                      type="number"
                      name="fundingUsd"
                      step="0.01"
                      min="0"
                      max="100000"
                      defaultValue={Number(p.funding_usd ?? 0)}
                      className="max-w-36"
                    />
                  </Field>
                  <ActionButton variant="outline" pendingLabel="Saving...">
                    Save
                  </ActionButton>
                </form>
                {p.funding_deducted_px > 0 && (
                  <p className="hc-caption text-sm">
                    Already approved once: {p.funding_deducted_px.toLocaleString()} px was withheld from the payout
                    for this grant.
                  </p>
                )}
                <div>
                  <p className="hc-eyebrow mb-2">Bill of materials</p>
                  {p.bom_url && bomPromise ? (
                    <div className="flex flex-col gap-2">
                      <Suspense fallback={<Muted className="text-sm">Loading BOM preview...</Muted>}>
                        <Await promise={bomPromise}>
                          {(bomRows) =>
                            bomRows ? (
                              <Details
                                summary={`View BOM (${bomRows.length - 1} item${bomRows.length - 1 === 1 ? "" : "s"})`}
                              >
                                <Table headers={bomRows[0]}>
                                  {bomRows.slice(1).map((row, i) => (
                                    <tr key={i}>
                                      {row.map((cell, j) => (
                                        <td key={j} className="whitespace-nowrap">
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </Table>
                              </Details>
                            ) : (
                              <Muted className="text-sm">Couldn&apos;t load a preview, download it instead.</Muted>
                            )
                          }
                        </Await>
                      </Suspense>
                      <TextLink href={p.bom_url} external className="text-sm">
                        Download BOM (.csv)
                      </TextLink>
                    </div>
                  ) : (
                    <Muted className="text-sm">Not uploaded.</Muted>
                  )}
                </div>
                <div>
                  <p className="hc-eyebrow mb-2">Cart screenshot{cartScreenshots.length === 1 ? "" : "s"}</p>
                  {cartScreenshots.length ? (
                    <div className="flex flex-wrap gap-2">
                      {cartScreenshots.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt={`Cart screenshot ${i + 1}`}
                            className="h-24 w-24 rounded-lg border border-[var(--border)] object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <Muted className="text-sm">None uploaded.</Muted>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Suspense fallback={<CardSkeleton lines={6} />}>
            <Await
              promise={Promise.all([
                commitsPromise,
                yswsPromise,
                hackatimeReportPromise,
                ownerHandlePromise,
                fraudyChecksPromise,
              ])}
            >
              {([commits, yswsShips, hackatimeReport, ownerHandle, fraudyChecks]) => (
                <ReviewDetailTabs
                  projectId={p.id}
                  commits={commits}
                  journals={journals}
                  contributorNames={Object.fromEntries(
                    contributorsFor(ownerNameFor(ownerHandle)).map((c) => [c.userId, c.name]),
                  )}
                  reviewAudits={
                    // Masked on the server so hidden reviewers' names never
                    // reach the client props.
                    hideReviewers
                      ? reviewAudits.map((a) => (rn(a.reviewer) === "Reviewer" ? { ...a, reviewer: "Reviewer" } : a))
                      : reviewAudits
                  }
                  yswsShips={yswsShips}
                  yswsImport={
                    p.imported_from_ysws
                      ? {
                          ysws: String(p.imported_from_ysws),
                          hours: Number(p.imported_ysws_hours) || 0,
                          approvedAt: p.imported_ysws_approved_at ? String(p.imported_ysws_approved_at) : null,
                        }
                      : null
                  }
                  hackatime={live && hackatimeReport ? { ...hackatimeReport, hackatimeUserId: "" } : hackatimeReport}
                  repoUrl={p.repo_url ?? null}
                  projectKind={p.kind}
                  usedAi={!!p.used_ai}
                  aiNotes={p.ai_notes ?? null}
                  fraudyChecks={fraudyChecks}
                  canViewAiTime={canViewAiTime}
                />
              )}
            </Await>
          </Suspense>
        </div>

        <aside
          id="review-panel"
          className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-10rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
        >
          <MobileReviewSheetHeader
            title={isProposedBan ? "Final review" : spotCheckStage ? "Spot check" : "First pass review"}
          />
          {/* Pinned above the tabs, never behind a click: the "stop and look
              at this before you decide" states. */}
          {isHeld && (
            <Callout tone="warning" icon="private">
              <p className="font-bold">On hold, can&apos;t be reviewed right now</p>
              <p className="mt-1">{p.hold_reason || "No reason given."}</p>
              <p className="hc-caption mt-1 text-xs">
                Held by {rn(p.hold_by, "an owner")}
                {p.hold_at ? ` on ${formatDateTime(p.hold_at)}` : ""}.
              </p>
              {(access.isOwner || heldByMe) && (
                <form action={releaseReviewHold} className="mt-2">
                  <input type="hidden" name="projectId" value={p.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <ActionButton
                    variant="outline"
                    size="sm"
                    pendingLabel="Releasing..."
                    confirm="Release the hold on this project? It goes back to normal review."
                  >
                    Release hold
                  </ActionButton>
                </form>
              )}
            </Callout>
          )}

          {spotCheckStage && p.second_pass_note && (
            <Card padding="compact">
              <p className="hc-heading text-sm">Fraud triage note ({rn(p.second_pass_by, "a reviewer")})</p>
              <p className="hc-caption mt-1 whitespace-pre-wrap text-sm">{p.second_pass_note}</p>
            </Card>
          )}

          {ageFlag && (
            <Callout tone="warning" icon="important">
              <p className="font-bold">Age eligibility</p>
              <p className="mt-1">
                This submitter turned 19 between shipping this project and now. Hack Club&apos;s YSWS guidelines want an
                Override Age Justification documented before deciding. See the audit note in the review form.
              </p>
            </Callout>
          )}

          {isFinalStage && p.robert_trust_score != null && p.robert_trust_score <= ROBERT_FRAUD_THRESHOLD && (
            <Callout tone="danger" icon="important">
              <strong>Robert scored this {p.robert_trust_score}/10, its &quot;Fraud&quot; range.</strong>{" "}
              {p.robert_note || "No note given."} You can still approve it, but document why in your notes.
            </Callout>
          )}

          {isOwn && p.status === "shipped" && (
            <Callout tone="warning" icon="private">
              This is your own submission. Another reviewer has to do the first pass.
            </Callout>
          )}
          {isOwn && isFinalStage && (
            <Callout tone="warning" icon="private">
              Your own submission. Another owner has to give the final verdict.
            </Callout>
          )}

          <Tabs variant="segmented" sticky tabs={rightTabs} />
        </aside>
      </ReviewSplit>

      <nav className="hc-review-dock">
        <ReviewShortcuts />
        <Suspense
          fallback={
            <div className="hc-dock-desktop">
              <QueueNav prevId={null} nextId={null} index={-1} total={0} />
            </div>
          }
        >
          <Await promise={queuePromise}>
            {(queue) => {
              // projects.id is a Postgres bigint; compare numerically so a
              // bigint serialized as a string doesn't miss the match.
              const idx = queue.findIndex((q) => Number(q.id) === projectId);
              const prevId = idx > 0 ? queue[idx - 1].id : null;
              const nextId = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1].id : null;
              return (
                <>
                  <div className="hc-dock-desktop">
                    <QueueNav prevId={prevId} nextId={nextId} index={idx} total={queue.length} />
                  </div>
                  <div className="hc-dock-mobile">
                    <QueueStep id={prevId} prev index={idx} total={queue.length} />
                    <MobileReviewButton index={idx} total={queue.length} />
                    <QueueStep id={nextId} prev={false} index={idx} total={queue.length} />
                  </div>
                </>
              );
            }}
          </Await>
        </Suspense>
      </nav>
    </div>
  );
}

function QueueNav({
  prevId,
  nextId,
  index,
  total,
}: {
  prevId: number | string | null;
  nextId: number | string | null;
  /** This submission's position in the queue, -1 when it isn't in it. */
  index: number;
  total: number;
}) {
  return (
    <>
      <QueueStep id={prevId} prev index={index} total={total} />
      <span className="hc-caption flex-1 text-center text-xs">
        {index < 0 && total > 0 ? "Not in queue · " : ""}
        <kbd className="hc-mono">←</kbd> <kbd className="hc-mono">→</kbd> move · <kbd className="hc-mono">R</kbd> repo ·{" "}
        <kbd className="hc-mono">D</kbd> demo
      </span>
      <QueueStep id={nextId} prev={false} index={index} total={total} />
    </>
  );
}

function QueueStep({
  id,
  prev,
  index,
  total,
}: {
  id: number | string | null;
  prev: boolean;
  index: number;
  total: number;
}) {
  // The position goes on the buttons ("Next · 4/21") so it's readable at a
  // glance; the middle of the bar lists the keyboard shortcuts instead.
  const position = (i: number) => (index >= 0 ? ` · ${i + 1}/${total}` : "");
  const body = prev ? (
    <>
      <Icon glyph="view-back" size={18} />
      <span className="hc-step-label">Prev{id != null && position(index - 1)}</span>
    </>
  ) : (
    <>
      <span className="hc-step-label">Next{id != null && position(index + 1)}</span>
      <Icon glyph="view-forward" size={18} />
    </>
  );
  return id != null ? (
    <Link
      href={`/review/${id}`}
      prefetch={false}
      data-shortcut={prev ? "prev" : "next"}
      aria-label={prev ? "Previous submission" : "Next submission"}
      className={`${buttonClass("outline", "md")} hc-queue-step`}
    >
      {body}
    </Link>
  ) : (
    <span className={`${buttonClass("outline", "md")} hc-queue-step pointer-events-none opacity-40`} aria-disabled>
      {body}
    </span>
  );
}

// What the server's AI pre-check found on the latest ship (apps/server/src/
// precheck/). Missing items are the clear-cut requirements; notes are the
// model's read and never decided anything on their own. Model text renders as
// plain text.
function PrecheckCallout({ view }: { view: PrecheckView | null }) {
  if (!view) return null;
  if (view.status === "pending")
    return (
      <Callout tone="neutral" icon="clock">
        AI pre-check is still running on this ship.
      </Callout>
    );
  if (view.status === "error")
    return (
      <Callout tone="neutral" icon="info">
        AI pre-check couldn&apos;t run on this ship{view.skipped ? `: ${view.skipped}` : "."}
      </Callout>
    );
  const missing = view.findings.length > 0;
  return (
    <Callout tone={missing ? "warning" : "info"} icon={missing ? "important" : "info"}>
      <div className="flex flex-col gap-2">
        <strong>
          {view.status === "sent_back"
            ? "AI pre-check sent this back to the maker"
            : missing
              ? "AI pre-check: required items look missing"
              : "AI pre-check: nothing required is missing"}
        </strong>
        {view.summary && <span>{view.summary}</span>}
        {missing && (
          <ul className="list-disc pl-5">
            {view.findings.map((f) => (
              <li key={f.id}>
                {f.label}
                {f.evidence && <span className="hc-caption"> ({f.evidence})</span>}
              </li>
            ))}
          </ul>
        )}
        {view.notes.length > 0 && (
          <div>
            <span className="hc-caption">Notes for you (never sent anything back):</span>
            <ul className="list-disc pl-5">
              {view.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {view.skipped && <span className="hc-caption">Skipped: {view.skipped}</span>}
      </div>
    </Callout>
  );
}
