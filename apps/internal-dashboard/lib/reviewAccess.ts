// Pure review-permission rules (no Next, no DB) so they're unit-testable.
// app/actions.ts feeds them the session, the project row and the lookups.

import type { ReviewQueueScope } from "./roles";

export interface ReviewViewer {
  isOwner: boolean;
  canSecondPass: boolean;
  reviewQueues: ReviewQueueScope;
  session: { slackId: string };
}

// A reviewer restricted to one queue (REVIEW_HARDWARE_ONLY /
// REVIEW_SOFTWARE_ONLY) may only act on projects of that kind - the same rule
// app/review/[id]/page.tsx applies when rendering, enforced again inside the
// actions so a hand-crafted form post can't reach the other queue. A project
// with no kind is treated like the page treats it: not in a restricted queue.
export function queueAllows(scope: ReviewQueueScope, kind: string | null | undefined): boolean {
  return scope === "both" || kind === scope;
}

// Self-review: the viewer (every users row carrying their Slack id) owns the
// project, or is a collaborator on it - accepted, or invited and still
// pending (they could accept right after the verdict). Either way they'd be
// paid when it's approved, so they may not review it. Applies to owners too.
export function isOwnOrCollaborator(
  viewerUserIds: readonly string[],
  ownerUserId: string | null | undefined,
  collaboratorUserIds: readonly string[],
): boolean {
  if (viewerUserIds.length === 0) return false;
  const mine = new Set(viewerUserIds.filter(Boolean));
  if (ownerUserId && mine.has(ownerUserId)) return true;
  return collaboratorUserIds.some((id) => mine.has(id));
}

// Extracts the Slack id from an actorName()-formatted string ("Name (SlackID)").
// Compare reviewers by this, never by the whole label: the display-name half
// changes whenever someone edits their Slack profile.
export function slackIdFromActorName(label: string | null | undefined): string {
  return (label ?? "").match(/\(([^)]+)\)\s*$/)?.[1] ?? "";
}

// A verdict on a first-pass BAN PROPOSAL (stage second_review,
// first_pass_verdict = "banned").
// - Ban decisions are owner-only (spec): confirming the ban, or approving the
//   project outright, is a final decision only an owner makes.
// - A non-owner final reviewer who disagrees with the ban ("approved") does
//   NOT final-approve: the project goes back into the normal pipeline
//   (fraud_review -> Robert -> owner Spot check), exactly like a first-pass
//   approval.
// - "needs_changes" bounces it to the maker, as from any stage.
// - Nobody may decide on a project they own or collaborate on, owners included
//   (it would be approving or banning their own work).
export type ProposedBanDecision =
  | { kind: "deny"; reason: string }
  | { kind: "final" } // owner: the verdict applies as-is
  | { kind: "reroute_to_pipeline" } // non-owner overturn: treat as first-pass approval
  | { kind: "needs_changes" };

export function proposedBanDecision(
  viewer: ReviewViewer,
  verdict: string,
  opts: { own: boolean; proposedBy: string; actor: string },
): ProposedBanDecision {
  if (opts.own) return { kind: "deny", reason: "You can't decide on a project you own or collaborate on." };
  if (!viewer.canSecondPass && !viewer.isOwner)
    return { kind: "deny", reason: "You don't have second-pass review access." };
  // By Slack id: the same person under a renamed display name is still the
  // same reviewer. An unparseable proposer label is treated as a match (deny).
  const proposerId = slackIdFromActorName(opts.proposedBy);
  const actorId = slackIdFromActorName(opts.actor) || viewer.session.slackId;
  if (!viewer.isOwner && (!proposerId || proposerId === actorId))
    return { kind: "deny", reason: "A different reviewer must confirm or overturn this ban proposal." };
  if (verdict === "needs_changes") return { kind: "needs_changes" };
  if (viewer.isOwner) return { kind: "final" };
  if (verdict === "ban") return { kind: "deny", reason: "Only an owner can confirm a ban." };
  if (verdict === "approved") return { kind: "reroute_to_pipeline" };
  return { kind: "deny", reason: "Unknown verdict." };
}

// Putting a review on hold must not clobber somebody else's active hold
// (that would silently take over their hold and its reason). No hold, or a
// hold that's already yours: fine. Someone else's (or one whose setter can't
// be identified): owners only.
export function canSetHold(
  current: { held: boolean; holderSlackId: string | null | undefined },
  viewer: { isOwner: boolean; session: { slackId: string } },
): boolean {
  if (!current.held || viewer.isOwner) return true;
  const holder = (current.holderSlackId ?? "").trim();
  return holder !== "" && holder === viewer.session.slackId;
}

// ---- Builder PII on the review page (app/review/[id]) ----
//
// Contact/identity PII (legal name, email, exact birth date, mailing address)
// is only for final (second-pass) reviewers and owners. A first-pass reviewer
// reviews code and hours; for the eligibility check they get the builder's
// AGE (not the birth date) plus whether each unified-DB field is on file,
// never the values themselves.
export function canSeeBuilderPII(viewer: { isOwner: boolean; canSecondPass: boolean }): boolean {
  return viewer.isOwner || viewer.canSecondPass;
}

// The name to show for a builder (project owner or collaborator) anywhere a
// reviewer sees one: the legal name (users.real_name) for owners and final
// reviewers only; everyone else gets the Slack handle / in-game display_name /
// Slack id, never real_name, whatever the row carries.
export interface BuilderNameSource {
  real_name?: string | null;
  display_name?: string | null;
  slack_id?: string | null;
}

export function builderNameFor(
  viewer: { isOwner: boolean; canSecondPass: boolean },
  user: BuilderNameSource | null | undefined,
  opts: { handle?: string | null; fallback?: string } = {},
): string {
  const legal = canSeeBuilderPII(viewer) ? (user?.real_name ?? "").trim() : "";
  return (legal || opts.handle || user?.display_name || user?.slack_id || opts.fallback || "").trim();
}

// Drops real_name from a joined users row unless the viewer may see it, so a
// legal name never reaches a page payload (or a client component's props)
// for a first-pass reviewer even where it isn't rendered.
export function redactBuilderUser<T extends BuilderNameSource>(
  viewer: { isOwner: boolean; canSecondPass: boolean },
  user: T | null | undefined,
): T | null | undefined {
  if (!user || canSeeBuilderPII(viewer) || !("real_name" in user)) return user;
  const { real_name: _hidden, ...rest } = user;
  return rest as T;
}

export interface BuilderRaw {
  fullName: string;
  email: string;
  birthday: string; // decrypted ISO date or ""
  age: number | null;
  country: string;
  address: string; // joined, "" when none
}

export interface BuilderView {
  privileged: boolean;
  fullName: string;
  email: string;
  ageLabel: string;
  country: string;
  // null = don't render the address row at all.
  address: string | null;
}

const onFile = (v: string) => (v.trim() && v.trim() !== "-" ? "on file" : "missing");

export function builderDetailsView(
  viewer: { isOwner: boolean; canSecondPass: boolean },
  isFinalStage: boolean,
  raw: BuilderRaw,
): BuilderView {
  const ageText = raw.age != null ? String(raw.age) : "-";
  if (!canSeeBuilderPII(viewer)) {
    return {
      privileged: false,
      fullName: onFile(raw.fullName),
      email: onFile(raw.email),
      ageLabel: ageText,
      country: onFile(raw.country),
      address: null,
    };
  }
  return {
    privileged: true,
    fullName: raw.fullName || "-",
    email: raw.email || "-",
    ageLabel: raw.age != null ? `${raw.age}${isFinalStage && raw.birthday ? ` (born ${raw.birthday})` : ""}` : "-",
    country: raw.country || "-",
    address: isFinalStage ? raw.address || "-" : null,
  };
}


// Same visibility policy as the reviewer detail page: evidence endpoints and
// search must not disclose out-of-queue projects or restricted review stages.
export function canReadReviewEvidence(
  viewer: { reviewQueues: ReviewQueueScope; canFraudReview: boolean },
  project: { kind: string | null | undefined; status: string | null | undefined },
): boolean {
  if (!queueAllows(viewer.reviewQueues, project.kind)) return false;
  if ((project.status === "fraud_review" || project.status === "second_review") && !viewer.canFraudReview)
    return false;
  return true;
}
