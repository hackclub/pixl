"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  config,
  levelForRe,
  pxPerHourOver,
  reForHours,
  projectPayoutPx,
  hackatimeCutoffUnix,
  hackatimeCutoffLabel,
} from "./_generated/config";
import {
  notifyShopInsert,
  notifyShopDelete,
  notifyShopUpdates,
  type ShopRowSnapshot,
} from "@/lib/shopNotify";
import {
  db,
  getAdmin,
  listAdmins,
  ackGuidelines,
  playerLabel,
  logModAction,
  creditProjectPixels,
  revokeProjectPixels,
  projectPixelTotal,
  lifetimeRe,
  creditReviewerPixels,
  type CreditReviewerResult,
  activeDashEvents,
  communityGoalShipCount,
  addReportViewer,
  removeReportViewer,
  addHelper,
  removeHelper,
  addFulfiller,
  removeFulfiller,
  addModerator,
  removeModerator,
  addSuperAdmin,
  removeSuperAdmin,
  listSuperAdmins,
  insertBanProposal,
  getBanProposal,
  decideBanProposal,
  nextReviewId,
  EVENT_TYPES,
  REFERRAL_BOOST_PX_PER_HOUR,
  REFERRAL_BOOST_SHIP_CAP,
  REFERRAL_MILESTONE_EVERY,
  REFERRAL_MILESTONE_PX,
  referralTierFor,
  turnedNineteenSinceShipping,
  type DashEventRow,
  getReviewPayoutSettings,
} from "@/lib/db";
import { buildAuditNote, parseAuditNote, TECHNICAL_FEATURES_MIN } from "@/lib/auditNote";
import { decryptPII } from "@/lib/crypto";
import { buildAirtableFields, pushProjectRecord } from "@/lib/airtable";
import { joeEnabled } from "@/lib/joe";
import { submitToJoe } from "@/lib/joeSync";
import { slackHandle, dmUser, slackAvatars } from "@/lib/slack";
import { fetchHackatimeReport, fetchTrackedSecondsSince } from "@/lib/hackatime";
import { serializeGroups } from "@/lib/shopOptions";
import { SHOP_REGIONS, type ShopRegion } from "@/lib/shopRegions";
import { SHOP_CATEGORIES, type ShopCategory } from "@/lib/shopCategories";
import { kickOnlinePlayer } from "@/lib/gameServer";
import { dmOrEmail } from "@/lib/notify";
import { assertSafeExternalUrl } from "@/lib/urlSafety";
import {
  requirePerm,
  requireSuper,
  requireReportViewer,
  requireFulfiller,
  requireModerator,
  requireWarnAccess,
  isSuperAdmin,
  ownerSlackIds,
  secondPassSlackIds,
  SUBADMIN_PERMISSIONS,
  NO_REVIEW,
  SECOND_PASS,
  SPONSOR,
  SPONSOR_BASE_PERMS,
  REVIEW_HARDWARE_ONLY,
  REVIEW_SOFTWARE_ONLY,
  type AdminAccess,
  type Permission,
  type ReviewQueueScope,
} from "@/lib/guard";
import { GUIDELINES_VERSION } from "@/lib/guidelines";

const DEFAULT_WARNING =
  "Please keep chat messages and display names appropriate. Continued violations may result in a ban from Pixl.";

// Was hardcoded to a stale personal dev domain (pixl-dash.ridit.space) that
// no longer resolves to anything real , BASE_URL is already set to the real
// production dashboard URL in every deployment's env (see lib/session.ts for
// the other place this app reads it), so use that instead of a second
// hand-maintained copy of the same fact.
const DASH_URL = process.env.BASE_URL ?? "https://dash.pixl.hackclub.com";

function actorName(access: AdminAccess): string {
  return `${access.session.name} (${access.session.slackId})`;
}

// Where to send a reviewer after they finish a verdict: straight to the next
// project in their queue if there is one, otherwise back to the list. `stage`
// is the stage of the project they just closed, so we keep them in the same
// pass (first vs final) when possible. Never throws, returns a path to redirect.
async function nextReviewPath(
  access: AdminAccess,
  by: string,
  stage: string,
  justReviewedId: number,
): Promise<string> {
  try {
    const nextId = await nextReviewId({
      viewer: access.session.slackId,
      by,
      canSecondPass: access.canSecondPass,
      isSuper: access.isSuper,
      excludeId: justReviewedId,
      prefer: stage === "second_review" ? "second_review" : "shipped",
    });
    return nextId ? `/review/${nextId}` : "/review";
  } catch {
    return "/review";
  }
}

// A project's tier (1-4) sets how much Restoration Energy each of its hours is
// worth; lifetime RE sets the player's hourly rate, ramping from basePayoutUsd
// to maxPayoutUsd. A player's rate for a ship comes from their RE *before* that
// ship. All of it is generated from packages/config/pixl.json - this file used
// to carry its own copy of the rate table and drifted from the server's (40/60
// vs the real 50/79, fixed 2026-08-01), which is exactly why it no longer does.
//
// Note: the DB column is `projects.level` but holds the tier (1-4). It predates
// the player-facing 1-100 level and isn't worth a migration to rename.

// A reviewer may never act on their own submission (self-review = cheating).
async function isOwnProject(access: AdminAccess, userId: string): Promise<boolean> {
  const { data } = await db.from("users").select("slack_id").eq("id", userId).single();
  return !!data?.slack_id && data.slack_id === access.session.slackId;
}

export async function warnPlayer(formData: FormData): Promise<void> {
  const by = await requireWarnAccess();
  const userId = String(formData.get("userId") ?? "");
  const message = String(formData.get("message") ?? "").trim() || DEFAULT_WARNING;
  if (!userId) return;

  const { error } = await db.from("notifications").insert({
    user_id: userId,
    title: "Moderation warning",
    body: message,
  });
  if (error) console.error("warn notification failed", error.message);

  await dmOrEmail(
    userId,
    "Moderation warning",
    [
      "You've received a moderation warning from Pixl.",
      message,
      "If you believe this is a mistake, reach out to the Pixl team.",
    ].join("\n\n"),
  );
  await logModAction(userId, "warn", message, by);
  revalidatePath("/", "layout");
}

function readSeconds(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "0"));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 86400);
}

async function claimedHoursFor(projectId: number): Promise<number> {
  const [{ data: journals }, { data: proj }] = await Promise.all([
    db.from("project_journals").select("hours, approved_hours, user_id").eq("project_id", projectId),
    db.from("projects").select("hackatime_seconds, kind, user_id").eq("id", projectId).single(),
  ]);
  // approved_hours is a reviewer's per-entry deflation (set from the
  // Journals tab) - null means "use the player's own claimed hours for this
  // entry", so it's the fallback, not a second number added on top.
  const journalHours =
    Math.round(
      (journals ?? []).reduce(
        (s, j) => s + (Number(j.approved_hours ?? j.hours) || 0),
        0,
      ) * 10,
    ) / 10;
  const rawTrackedHours =
    Math.round(((Number(proj?.hackatime_seconds) || 0) / 3600) * 10) / 10;
  // Hardware already folds journal hours into hackatime_seconds at ship time
  // (see apps/server/src/routes/projects.ts: trackedSeconds = htSeconds +
  // round(ownerJournalHours * 3600), owner-only, not collaborators). That
  // fold used the RAW hours at the moment of shipping, so subtract that same
  // raw (owner-only) sum back out to isolate the real, never-changing
  // Hackatime-only portion, then add today's journalHours (which reflects
  // any later reviewer deflation) on top. Returning rawTrackedHours directly
  // - or adding journalHours back after subtracting itself - cancels out any
  // approved_hours edit, which is exactly why deflating a journal entry had
  // no visible effect on what got credited for hardware ships.
  if (proj?.kind === "hardware") {
    const rawOwnerJournalHours =
      Math.round(
        (journals ?? [])
          .filter((j) => j.user_id === proj.user_id)
          .reduce((s, j) => s + (Number(j.hours) || 0), 0) * 10,
      ) / 10;
    const hackatimeOnlyHours = Math.max(
      0,
      Math.round((rawTrackedHours - rawOwnerJournalHours) * 10) / 10,
    );
    return hackatimeOnlyHours + journalHours;
  }
  return rawTrackedHours + journalHours;
}

async function insertReviewAudit(
  formData: FormData,
  projectId: number,
  userId: string,
  reviewer: string,
  verdict: string,
  note: string,
  claimedHours: number,
  approvedHours: number | null,
): Promise<void> {
  const { error } = await db.from("review_audits").insert({
    project_id: projectId,
    user_id: userId,
    reviewer,
    verdict,
    note,
    audit_note: String(formData.get("auditNote") ?? "").trim().slice(0, 5000),
    claimed_hours: claimedHours,
    approved_hours: approvedHours,
    repo_opened: formData.get("repoOpened") === "1",
    demo_opened: formData.get("demoOpened") === "1",
    repo_seconds: readSeconds(formData.get("repoSeconds")),
    demo_seconds: readSeconds(formData.get("demoSeconds")),
    total_seconds: readSeconds(formData.get("totalSeconds")),
  });
  if (error) console.error("review audit insert failed", error.message);
}

// Base pixels per review verdict are admin-configurable (review_payout_settings,
// migration 0162 - edited from the Admins page), replacing what used to be a
// flat PAYOUT_PIXELS=3-on-approval-only constant. Every review pays this rate
// in full , there is no cut for a rushed review, an unopened repo, an
// overturned first pass, or a sharp hours correction (removed 2026-09-05: a
// reviewer's payout should never depend on how the case turned out later).
// First-pass payouts stay pending until the final verdict settles.
function payoutVerdictKey(verdict: string): "approved" | "needs_changes" | null {
  if (verdict === "approved" || verdict === "first_pass_approved") return "approved";
  if (verdict === "needs_changes") return "needs_changes";
  return null;
}

// During a Review Blitz event every review's base payout is multiplied, so
// full_pixels is locked in at review time and settlement math uses the row.
// Returns both the multiplied amount and whether a multiplier actually
// applied, so dmPayout can call out the blitz bonus without needing its own
// copy of the base rate.
async function payoutBasePixels(
  verdict: string,
): Promise<{ full: number; blitzApplied: boolean }> {
  const key = payoutVerdictKey(verdict);
  if (!key) return { full: 0, blitzApplied: false };
  const settings = await getReviewPayoutSettings();
  const base = key === "approved" ? settings.approvedPixels : settings.needsChangesPixels;
  const [blitz] = await activeDashEvents(["review_blitz"]);
  const mult = blitz ? Math.min(Math.max(Number(blitz.config.mult) || 1, 1), 3) : 1;
  return { full: Math.round(base * mult), blitzApplied: mult > 1 };
}

async function dmPayout(
  slackId: string,
  projectName: string,
  paid: number,
  full: number,
  credited: CreditReviewerResult,
  blitzApplied: boolean,
): Promise<void> {
  const dollars = `$${(full * config.economy.pixelValueUsd).toFixed(2)}`;
  let text = `You earned ${paid} pixels (${dollars}) for reviewing "${projectName}". Thanks for keeping the queue moving!`;
  if (blitzApplied) text += `\n\n⚡ Review Blitz bonus included!`;
  // Only actually true when it's true , "nothing to credit" (the configured
  // rate is 0) isn't a missing account, it's just nothing to credit this
  // time, and shouldn't tell the reviewer their account is broken.
  if (credited === "no_account")
    text += `\n\nHeads up: there's no Pixl game account linked to your Slack, so the pixels couldn't be credited yet. Contact the team to get it sorted.`;
  await dmUser(slackId, text);
}

// Records and pays out immediately (approved, needs_changes, and a proposed-
// approval's eventual "first pass confirmed" case all settle right away , only
// a PENDING first-pass proposal goes through recordPendingPayout instead).
// Skips entirely (no row, no DM) when the configured rate for this verdict is
// 0, so setting needs_changes_pixels to 0 keeps today's "only approvals pay"
// behavior with no special-casing at call sites.
async function recordSettledPayout(
  projectId: number,
  access: AdminAccess,
  verdict: string,
  projectName: string,
): Promise<void> {
  const { full, blitzApplied } = await payoutBasePixels(verdict);
  if (full <= 0) return;
  const credited = await creditReviewerPixels(access.session.slackId, full);
  const { error } = await db.from("review_payouts").insert({
    project_id: projectId,
    reviewer: actorName(access),
    reviewer_slack_id: access.session.slackId,
    verdict,
    status: "paid",
    full_pixels: full,
    paid_pixels: full,
    credited: credited === "credited",
    settled_at: new Date().toISOString(),
  });
  if (error) {
    console.error("review payout insert failed", error.message);
    return;
  }
  await dmPayout(access.session.slackId, projectName, full, full, credited, blitzApplied);
}

async function recordPendingPayout(projectId: number, access: AdminAccess): Promise<void> {
  const { full, blitzApplied } = await payoutBasePixels("first_pass_approved");
  if (full <= 0) return;
  const { error } = await db.from("review_payouts").insert({
    project_id: projectId,
    reviewer: actorName(access),
    reviewer_slack_id: access.session.slackId,
    verdict: "first_pass_approved",
    status: "pending",
    full_pixels: full,
    blitz_applied: blitzApplied,
  });
  if (error) console.error("review payout insert failed", error.message);
}

// Settle every pending first-pass payout on a project once the final verdict
// lands, always at the full locked-in rate , regardless of whether the final
// reviewer agreed or cut the hours. The transition to 'paid' is guarded on
// the row still being pending so a double-submit can never double-pay.
async function settleFirstPassPayouts(projectId: number, projectName: string): Promise<void> {
  const { data: pending } = await db
    .from("review_payouts")
    .select("id, reviewer_slack_id, full_pixels, blitz_applied")
    .eq("project_id", projectId)
    .eq("status", "pending");
  for (const p of pending ?? []) {
    const full = Number(p.full_pixels) || 0;
    const { data: claimed } = await db
      .from("review_payouts")
      .update({
        status: "paid",
        paid_pixels: full,
        settled_at: new Date().toISOString(),
      })
      .eq("id", p.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed || claimed.length === 0) continue;
    const credited = await creditReviewerPixels(p.reviewer_slack_id, full);
    if (credited === "credited")
      await db.from("review_payouts").update({ credited: true }).eq("id", p.id);
    await dmPayout(p.reviewer_slack_id, projectName, full, full, credited, !!p.blitz_applied);
  }
}

// Reviewers are only paid when a project actually gets approved , a project
// sent back to first pass never got a real verdict, and a needs_changes/ban
// verdict is explicitly not an approval, so in both cases the pending
// first-pass payout is void , no pixels, no dock against the reviewer.
// Distinct from settleFirstPassPayouts, which always resolves to 'paid'
// (possibly cut) and should only ever be reached from the approved branch.
async function voidFirstPassPayouts(
  projectId: number,
  reason = "sent back for a redo before a final verdict",
): Promise<void> {
  const { error } = await db
    .from("review_payouts")
    .update({
      status: "voided",
      paid_pixels: 0,
      cut_pct: 100,
      cut_reason: reason,
      settled_at: new Date().toISOString(),
    })
    .eq("project_id", projectId)
    .eq("status", "pending");
  if (error) console.error("voidFirstPassPayouts failed", error.message);
}

// Lets a super admin change the per-verdict reviewer payout rate from the
// Admins page without a code change/redeploy - e.g. temporarily paying out
// on needs_changes during a review push, or adjusting the approval rate for
// a particular occasion. Both fields are clamped to a sane non-negative
// range; 0 disables payouts for that verdict entirely (recordSettledPayout /
// recordPendingPayout both skip when the resolved rate is 0).
export async function updateReviewPayoutSettings(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const clamp = (raw: FormDataEntryValue | null): number => {
    const n = Number(String(raw ?? "0"));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(Math.min(n, 1000) * 10) / 10;
  };
  const approvedPixels = clamp(formData.get("approvedPixels"));
  const needsChangesPixels = clamp(formData.get("needsChangesPixels"));
  const { error } = await db
    .from("review_payout_settings")
    .update({
      approved_pixels: approvedPixels,
      needs_changes_pixels: needsChangesPixels,
      updated_by: actorName(access),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) console.error("updateReviewPayoutSettings failed", error.message);
  revalidatePath("/admins");
}

// How a reviewer is credited in maker-facing notes. Prefers the Slack @handle;
// never leaks a raw Slack user id (login stores the id as the name when Slack
// gives us no real name), attribute it to the review team instead.
async function reviewerLabel(slackId: string, name: string): Promise<string> {
  const handle = await slackHandle(slackId);
  if (handle) return handle;
  return /^[UW][A-Z0-9]{6,}$/.test(name) ? "the review team" : name;
}

async function notifyOwner(
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  const { error } = await db.from("notifications").insert({ user_id: userId, title, body });
  if (error) console.error("review notification failed", error.message);
  await dmOrEmail(userId, title, body);
}

// Same "hackatime if tracked, else journal" source as claimedHoursFor(), but
// scoped to one collaborator's own journal entries and their own tracked
// Hackatime seconds (project_collaborators.hackatime_seconds), not the
// project as a whole.
async function claimedHoursForCollaborator(
  projectId: number,
  userId: string,
  hackatimeSeconds: number | null,
): Promise<number> {
  const { data: journals } = await db
    .from("project_journals")
    .select("hours, approved_hours")
    .eq("project_id", projectId)
    .eq("user_id", userId);
  const journalHours =
    Math.round(
      (journals ?? []).reduce((s, j) => s + (Number(j.approved_hours ?? j.hours) || 0), 0) * 10,
    ) / 10;
  const hackatimeHours = Math.round(((hackatimeSeconds || 0) / 3600) * 10) / 10;
  return hackatimeHours > 0 ? hackatimeHours : journalHours;
}

// Deflate (never inflate) a single journal entry's credited hours, straight
// from the Journals tab - claimedHoursFor() and claimedHoursForCollaborator()
// both fall back to approved_hours ?? hours per entry, so this immediately
// changes the overall claimed/credited total shown and enforced everywhere
// else on the review page, no separate "recompute total" step needed.
export async function setJournalHours(formData: FormData): Promise<void> {
  await requirePerm("review");
  const journalId = Number(formData.get("journalId") ?? 0);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!journalId || !projectId) return;
  const { data: journal } = await db
    .from("project_journals")
    .select("hours")
    .eq("id", journalId)
    .maybeSingle();
  if (!journal) return;
  const rawHours = Number(journal.hours) || 0;
  const raw = String(formData.get("hours") ?? "").trim();
  // Empty input clears the override back to the player's own claimed hours.
  const approvedHours =
    raw === "" ? null : Math.max(0, Math.min(rawHours, Math.round(Number(raw) * 10) / 10));
  if (raw !== "" && !Number.isFinite(Number(raw))) return;
  const { error } = await db
    .from("project_journals")
    .update({ approved_hours: approvedHours })
    .eq("id", journalId);
  if (error) throw new Error(error.message);
  revalidatePath(`/review/${projectId}`);
}

async function acceptedCollaboratorUserIds(projectId: number): Promise<string[]> {
  const { data } = await db
    .from("project_collaborators")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  return (data ?? []).map((r) => r.user_id as string);
}

// The Trial a project was shipped for (see [[trial-ship-review-reward]] in
// project memory) , carries an optional min-hours gate and a prize.
type LinkedTrial = {
  id: number;
  name: string;
  reward: string;
  min_hours: number | null;
  prize_shop_item_id: number | null;
};

// What a Trial actually hands over: its linked catalog item if it has one,
// otherwise the free-text reward, fulfilled by hand as a $0 custom order.
async function trialPrizeFor(trial: LinkedTrial): Promise<{ itemId: number | null; name: string }> {
  if (trial.prize_shop_item_id) {
    const { data: prizeItem } = await db
      .from("shop_items")
      .select("id, name")
      .eq("id", trial.prize_shop_item_id)
      .maybeSingle();
    if (prizeItem) return { itemId: prizeItem.id as number, name: prizeItem.name as string };
  }
  return { itemId: null, name: trial.reward || trial.name };
}

interface BeneficiaryPayout {
  totalPx: number;
  deltaPx: number;
  pxRate: number;
  xpBefore: number;
  goalNote: string;
  referralNote: string;
  alreadyPx: number;
  /** RE this ship earned, for the "you're now level N" line. */
  projectRe: number;
  /** Community-goal multiplier applied to the payout (1 = none). */
  goalMult: number;
  /** Pixels withheld from this payout for a hardware funding grant (0 = none). */
  fundingPx: number;
}

// Credits one beneficiary (the project owner, or an accepted collaborator)
// at their own rate tier for their own share of credited hours. This is what
// "split payout" means for a collaborative project, each person is treated
// like an independent earner (own lifetime-hours rate, own referral boost),
// just for their own hours slice instead of the whole project.
async function creditBeneficiary(
  userId: string,
  projectId: number,
  projectType: string,
  creditHours: number,
  shippedAt: string | null,
  by: string,
  otherBeneficiaryIds: string[] = [],
  tier = 1,
  holdPixels = false,
  fundingUsd = 0,
): Promise<BeneficiaryPayout> {
  let goalMult = 1;
  let goalNote = "";
  if (shippedAt) {
    const { data: goals } = await db
      .from("events")
      .select("*")
      .eq("type", "community_goal")
      .is("stopped_at", null)
      .lte("starts_at", shippedAt)
      .gt("ends_at", shippedAt);
    for (const g of (goals ?? []) as DashEventRow[]) {
      const target = Number(g.config.target) || 0;
      const bonusPct = Number(g.config.bonusPct) || 0;
      const wantType = String(g.config.projectType ?? "");
      if (wantType && wantType !== projectType) continue;
      if (target > 0 && bonusPct > 0 && (await communityGoalShipCount(g)) >= target) {
        goalMult *= 1 + bonusPct / 100;
        goalNote += ` The "${g.name}" community goal was hit , +${bonusPct}% on this project!`;
      }
    }
  }

  // The RE-driven rate averaged across the RE this ship earns on top of the
  // player's lifetime RE (xpBefore -> xpBefore + projectRe), so RE is
  // player-specific and banked forever - once a player has earned enough
  // lifetime RE to sit at the $6.00 cap, every future ship pays at that rate
  // too (RE announced, Gabin/Ridit/Ricky, 2026-08-25).
  const xpBefore = await lifetimeRe(userId, projectId);
  const projectRe = reForHours(creditHours, tier);
  let pxRate = pxPerHourOver(xpBefore, xpBefore + projectRe);
  const alreadyPx = await projectPixelTotal(projectId, userId);
  // A project only counts as a "new ship" for referral purposes the first
  // time it earns any pixels , re-approvals of an already-credited project
  // (edits, overturned first passes, etc.) don't re-trigger the boost/reward.
  const isNewShip = alreadyPx === 0;
  const { data: referral } = isNewShip
    ? await db
        .from("referrals")
        .select("id, referrer_id, rewarded_at, boosted_ships")
        .eq("referred_id", userId)
        .maybeSingle()
    : { data: null };

  let referralNote = "";
  if (referral && referral.boosted_ships < REFERRAL_BOOST_SHIP_CAP) {
    // Conditioned on the boosted_ships value we just read, so two ships for
    // the same referred player approved at the same instant can't both pass
    // the check before either write lands , only the update that still
    // matches the value it read wins the boost.
    const { data: claimed } = await db
      .from("referrals")
      .update({ boosted_ships: referral.boosted_ships + 1, boost_project_id: projectId })
      .eq("id", referral.id)
      .eq("boosted_ships", referral.boosted_ships)
      .select("id")
      .maybeSingle();
    if (claimed) {
      pxRate += REFERRAL_BOOST_PX_PER_HOUR;
      referralNote += ` +${REFERRAL_BOOST_PX_PER_HOUR}px/hr referral boost (${referral.boosted_ships + 1}/${REFERRAL_BOOST_SHIP_CAP} ships used).`;
    }
  }

  const grossPx = Math.round(creditHours * pxRate * goalMult);
  // Hardware funding grant: the reviewer-approved dollar amount comes out of
  // pixels rather than the maker's own wallet, converted at today's rate , so
  // the more they ask the shop to front, the fewer pixels they're credited.
  // Clamped so a grant can never push the payout negative.
  const fundingPx = fundingUsd > 0 ? Math.min(Math.round(fundingUsd / config.economy.pixelValueUsd), grossPx) : 0;
  const totalPx = grossPx - fundingPx;
  const deltaPx = totalPx - alreadyPx;
  // Trial ships settle later: the maker picks the Trial prize *or* these
  // pixels, so the payout is computed now and only credited once they choose
  // (projects.trial_reward_choice). Everything below still runs , the referral
  // boost and the referrer's own payout aren't the maker's pixels to hold.
  if (!holdPixels) await creditProjectPixels(userId, projectId, totalPx, creditHours, by);

  // Referrer payout: pays once per referral, on the first qualifying ship.
  // Skipped if the referrer is also a credited beneficiary (owner or
  // collaborator) on this same project , otherwise a referrer could invite
  // themselves onto the referred user's project (or vice versa) and collect
  // both their own collaborator pay and the referral bonus off one ship.
  // Left un-rewarded so the referral still pays out on a genuinely
  // independent ship later.
  const referrerRidingAlong = otherBeneficiaryIds.includes(referral?.referrer_id ?? "");
  if (referral && !referral.rewarded_at && !referrerRidingAlong) {
    const tier = referralTierFor(creditHours);
    if (tier) {
      // Conditioned on rewarded_at still being null, so two qualifying ships
      // for the same referred player approved at the same instant can't both
      // pay the referrer , only the update that still finds it unrewarded wins.
      const { data: claimed } = await db
        .from("referrals")
        .update({
          rewarded_at: new Date().toISOString(),
          reward_tier: tier.key,
          reward_pixels: tier.px,
          reward_project_id: projectId,
        })
        .eq("id", referral.id)
        .is("rewarded_at", null)
        .select("id")
        .maybeSingle();
      if (!claimed) return { totalPx, deltaPx, pxRate, xpBefore, goalNote, referralNote, alreadyPx, projectRe, goalMult, fundingPx };
      await db.rpc("adjust_user_pixels", {
        p_user_id: referral.referrer_id,
        p_amount: tier.px,
        p_reason: "referral_reward",
        p_created_by: by,
      });
      await db.from("notifications").insert({
        user_id: referral.referrer_id,
        title: "Referral reward!",
        body: `Someone you referred shipped a ${creditHours}h project , you earned ${tier.px} pixels ($${(tier.px * config.economy.pixelValueUsd).toFixed(2)})!`,
      });

      const { count: rewardedCount } = await db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", referral.referrer_id)
        .not("rewarded_at", "is", null);
      if (rewardedCount && rewardedCount % REFERRAL_MILESTONE_EVERY === 0) {
        await db.rpc("adjust_user_pixels", {
          p_user_id: referral.referrer_id,
          p_amount: REFERRAL_MILESTONE_PX,
          p_reason: "referral_milestone",
          p_created_by: by,
        });
        await db.from("notifications").insert({
          user_id: referral.referrer_id,
          title: "Referral milestone!",
          body: `${rewardedCount} of your referrals have shipped , bonus ${REFERRAL_MILESTONE_PX} pixels ($${(REFERRAL_MILESTONE_PX * config.economy.pixelValueUsd).toFixed(2)})!`,
        });
      }
    }
  }

  return { totalPx, deltaPx, pxRate, xpBefore, goalNote, referralNote, alreadyPx, projectRe, goalMult, fundingPx };
}

// Two-pass review. A shipped project always gets a first pass from *some*
// reviewer , even a final reviewer's first look on a fresh 'shipped' project is
// only a proposal, same as anyone else's. It moves to 'second_review' and needs
// a DIFFERENT final reviewer to confirm or overturn it before pixels are
// credited. "Request changes" bounces it back to the maker from either stage.
export async function reviewProject(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const verdict = String(formData.get("verdict") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  if (!projectId || !["approved", "needs_changes", "ban"].includes(verdict)) return;

  const { data: current } = await db
    .from("projects")
    .select(
      "status, user_id, name, description, image_url, first_pass_by, first_pass_hours, first_pass_verdict, shipped_at, sidequest_id, trial_reward_choice, needs_funding, funding_usd",
    )
    .eq("id", projectId)
    .single();
  if (!current) return;
  const { data: submitter } = await db
    .from("users")
    .select("birthday")
    .eq("id", current.user_id)
    .maybeSingle();
  const ageFlag = turnedNineteenSinceShipping(submitter?.birthday ?? null, current.shipped_at);
  const stage = String(current.status);
  const back = `/review/${projectId}`;

  let linkedTrial: LinkedTrial | null = null;
  if (current.sidequest_id) {
    const { data: sq } = await db
      .from("sidequests")
      .select("id, name, reward, min_hours, prize_shop_item_id")
      .eq("id", current.sidequest_id)
      .maybeSingle();
    linkedTrial = sq as LinkedTrial | null;
  }
  const own = await isOwnProject(access, current.user_id);
  if (stage === "shipped" && !access.isSuper && own)
    redirect(`${back}?error=${encodeURIComponent("You can't first-pass your own project , another reviewer has to take it.")}`);
  if (stage !== "shipped" && stage !== "second_review")
    redirect(`${back}?error=${encodeURIComponent("This project isn't awaiting review anymore.")}`);
  if (!note)
    redirect(`${back}?error=${encodeURIComponent("Feedback is required for every verdict.")}`);

  const claimedHours = await claimedHoursFor(projectId);
  const hoursRaw = String(formData.get("approvedHours") ?? "").trim();
  let approvedHours: number | null = null;
  if (hoursRaw !== "") {
    const n = Number(hoursRaw);
    if (!Number.isFinite(n) || n < 0)
      redirect(`${back}?error=${encodeURIComponent("Credited hours must be a number of 0 or more.")}`);
    approvedHours = Math.min(Math.round(n * 10) / 10, claimedHours);
  }

  // The tier rides along with the verdict so a reviewer sets hours and tier in
  // one place and sees the resulting RE before submitting, instead of using the
  // separate re-grade form and guessing. Absent (older form, or a non-approve
  // verdict) means leave whatever is stored alone.
  const tierRaw = String(formData.get("tier") ?? "").trim();
  if (tierRaw !== "") {
    const t = Number(tierRaw);
    if (!Number.isInteger(t) || t < 1 || t > 4)
      redirect(`${back}?error=${encodeURIComponent("Tier must be between 1 and 4.")}`);
    const { data: cur } = await db
      .from("projects")
      .select("user_id, level")
      .eq("id", projectId)
      .maybeSingle();
    if (cur && Number(cur.level) !== t) {
      if (await isOwnProject(access, cur.user_id as string))
        redirect(
          `${back}?error=${encodeURIComponent("You can't change the tier of your own project.")}`,
        );
      await db.from("projects").update({ level: t }).eq("id", projectId);
      await logModAction(
        cur.user_id as string,
        "project_level_changed",
        `tier set to T${t} (was T${cur.level ?? 1}) with the verdict`,
        by,
      );
    }
  }

  // Structured internal audit note (Hack Club's YSWS "override hours spent
  // justification" guidance) , the form submits each section separately so we
  // can validate the parts that matter, then store them as one string under
  // the existing auditNote field.
  // Technical features / additional notes are only mandatory for a verdict
  // that actually needs to hold up as an audit trail (approve, or a proposed/
  // confirmed ban) - a "request changes" bounce-back has its own player-facing
  // note field for that, and reviewers kept typing a throwaway line here just
  // to satisfy the requirement.
  const auditSectionsRequired = verdict !== "needs_changes";
  const technicalFeatures = String(formData.get("technicalFeatures") ?? "").trim();
  if (auditSectionsRequired && technicalFeatures.length < TECHNICAL_FEATURES_MIN)
    redirect(
      `${back}?error=${encodeURIComponent(`Describe concrete technical features you checked (min ${TECHNICAL_FEATURES_MIN} characters).`)}`,
    );
  const deflated = approvedHours != null && approvedHours < claimedHours;
  const deflationReason = String(formData.get("deflationReason") ?? "").trim();
  if (deflated && !deflationReason)
    redirect(`${back}?error=${encodeURIComponent("Explain why the credited hours were lowered.")}`);
  const ageJustification = String(formData.get("ageJustification") ?? "").trim();
  if (ageFlag && !ageJustification)
    redirect(
      `${back}?error=${encodeURIComponent("This submitter turns 19 between shipping and review , document that before deciding.")}`,
    );
  const notes = String(formData.get("notes") ?? "").trim();
  if (auditSectionsRequired && !notes)
    redirect(`${back}?error=${encodeURIComponent("Additional notes are required.")}`);
  formData.set(
    "auditNote",
    buildAuditNote({
      "TECHNICAL FEATURES": technicalFeatures,
      "HACKATIME EVIDENCE": String(formData.get("hackatimeEvidence") ?? "").trim(),
      "DEFLATION REASON": deflationReason,
      "AGE JUSTIFICATION": ageJustification,
      NOTES: notes,
    }),
  );

  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);
  // Whether the approve/needs-changes notification below shows this reviewer's
  // real name or a generic "the review team", ticked by default in the form,
  // a reviewer can opt out per verdict. Internal records (mod actions, audit
  // rows, ban_by, first_pass_by, etc.) always keep the real reviewer; this
  // only ever swaps the player-facing notification text.
  const revealName = formData.get("revealName") === "1";
  const playerFacingReviewer = revealName ? reviewer : "the review team";

  // First pass on a freshly-shipped project: approve and ban are only PROPOSALS,
  // regardless of the reviewer's own permissions, the project is held in
  // 'second_review' carrying what was proposed so a different final reviewer
  // confirms or overturns it. "Request changes" is the exception: it never needs
  // a second pass, so it falls through to bounce straight back to the maker.
  if (stage === "shipped" && verdict !== "needs_changes") {
    const proposedKey = verdict === "ban" ? "banned" : verdict;
    const { data: project, error } = await db
      .from("projects")
      .update({
        status: joeEnabled() ? "fraud_review" : "second_review",
        review_note: note,
        review_note_by: reviewer,
        approved_hours: approvedHours,
        reviewing_by: "",
        reviewing_at: null,
        first_pass_by: by,
        first_pass_at: new Date().toISOString(),
        first_pass_note: note,
        first_pass_hours: approvedHours,
        first_pass_verdict: proposedKey,
      })
      .eq("id", projectId)
      .eq("status", "shipped")
      .select("id, name, user_id")
      .single();
    if (error || !project) {
      console.error("reviewProject (first pass) failed", error?.message);
      return;
    }
    await insertReviewAudit(formData, projectId, project.user_id, by, `first_pass_${proposedKey}`, note, claimedHours, approvedHours);
    // Only a proposed approval can ever turn into a paid review , a proposed
    // ban never gets a pending payout row to begin with, instead of creating
    // one just to void it later if the final reviewer confirms the ban.
    if (!own && proposedKey === "approved") await recordPendingPayout(projectId, access);
    if (proposedKey === "approved") {
      await notifyOwner(
        project.user_id,
        "First pass complete!",
        `"${project.name}" passed first-pass review by ${playerFacingReviewer}. It still needs a second reviewer to confirm before your pixels are credited , hang tight!`,
      );
      for (const collaboratorId of await acceptedCollaboratorUserIds(projectId)) {
        await notifyOwner(
          collaboratorId,
          "First pass complete!",
          `A project you collaborate on, "${project.name}", passed first-pass review by ${playerFacingReviewer}. It still needs a second reviewer to confirm before pixels are credited.`,
        );
      }
    }
    await logModAction(project.user_id, "project_first_pass", `${project.name}: proposed ${proposedKey.replace("_", " ")} , ${note}`, by);
    await submitToJoe(projectId);
    const nextPath = await nextReviewPath(access, by, stage, projectId);
    revalidatePath("/review");
    redirect(nextPath);
  }

  // From here the project is in 'second_review' (a final reviewer confirming or
  // overturning the first-pass proposal), or it's a first-pass "request changes"
  // falling through to bounce straight back to the maker. These two guards only
  // apply to the second_review case.
  if (stage === "second_review" && !access.canSecondPass)
    redirect(`${back}?error=${encodeURIComponent("Only a final reviewer can decide this stage.")}`);
  if (stage === "second_review" && !access.isSuper && current.first_pass_by && current.first_pass_by === by)
    redirect(`${back}?error=${encodeURIComponent("A different reviewer must do the final pass.")}`);

  // Request changes , bounce back to the maker.
  if (verdict === "needs_changes") {
    const { data: project, error } = await db
      .from("projects")
      .update({
        status: "needs_changes",
        review_note: note,
        review_note_by: reviewer,
        reviewing_by: "",
        reviewing_at: null,
        first_pass_by: "",
        first_pass_at: null,
        first_pass_note: "",
        first_pass_hours: null,
        first_pass_verdict: null,
      })
      .eq("id", projectId)
      .in("status", ["shipped", "second_review"])
      .select("id, name, user_id")
      .single();
    if (error || !project) {
      console.error("reviewProject (changes) failed", error?.message);
      return;
    }
    await insertReviewAudit(formData, projectId, project.user_id, by, "needs_changes", note, claimedHours, approvedHours);
    if (stage === "second_review")
      await voidFirstPassPayouts(projectId, "final verdict was needs_changes, not an approval");
    // Pays out only when an admin has set needs_changes_pixels above 0 (see
    // updateReviewPayoutSettings) - 0 keeps the historical "only approvals
    // pay" behavior with no special-casing here.
    if (!own) await recordSettledPayout(projectId, access, "needs_changes", project.name);
    await notifyOwner(
      project.user_id,
      "Changes requested",
      `"${project.name}" needs changes before it can be approved , ${playerFacingReviewer}:\n\n${note}\n\nUpdate your project and ship it again.`,
    );
    for (const collaboratorId of await acceptedCollaboratorUserIds(projectId)) {
      await notifyOwner(
        collaboratorId,
        "Changes requested",
        `"${project.name}" needs changes before it can be approved , ${playerFacingReviewer}:\n\n${note}`,
      );
    }
    await logModAction(project.user_id, "project_needs_changes", `${project.name}: ${note}`, by);
    const nextPath = await nextReviewPath(access, by, stage, projectId);
    revalidatePath("/review");
    redirect(nextPath);
  }

  // Ban , a final reviewer confirms a proposed ban (or a senior bans outright).
  if (verdict === "ban") {
    const { data: project, error } = await db
      .from("projects")
      .update({
        banned_at: new Date().toISOString(),
        ban_reason: note,
        ban_by: reviewer,
        reviewing_by: "",
        reviewing_at: null,
        first_pass_verdict: null,
      })
      .eq("id", projectId)
      .in("status", ["shipped", "second_review"])
      .select("id, name, user_id")
      .single();
    if (error || !project) {
      console.error("reviewProject (ban) failed", error?.message);
      return;
    }
    await insertReviewAudit(formData, projectId, project.user_id, by, "banned", note, claimedHours, approvedHours);
    if (stage === "second_review")
      await voidFirstPassPayouts(projectId, "final verdict was a ban, not an approval");
    const banBody =`Your project "${project.name}" was permanently banned by ${reviewer} and can no longer be shipped to Pixl.\n\nReason: ${note}\n\nIf you think this is a mistake, contact the Pixl team.`;
    await db.from("notifications").insert({ user_id: project.user_id, title: "Project banned", body: banBody });
    await dmOrEmail(project.user_id, "Project banned", banBody);
    const collabBanBody = `A project you collaborate on, "${project.name}", was permanently banned by ${reviewer} and can no longer be shipped to Pixl.\n\nReason: ${note}\n\nIf you think this is a mistake, contact the Pixl team.`;
    for (const collaboratorId of await acceptedCollaboratorUserIds(projectId)) {
      await db.from("notifications").insert({ user_id: collaboratorId, title: "Project banned", body: collabBanBody });
      await dmOrEmail(collaboratorId, "Project banned", collabBanBody);
    }
    await logModAction(project.user_id, "project_banned", `${project.name}: ${note}`, by);
    const nextPath = await nextReviewPath(access, by, stage, projectId);
    revalidatePath("/review");
    revalidatePath("/", "layout");
    redirect(nextPath);
  }

  const creditHours = approvedHours ?? claimedHours;

  // A Trial's min-hours requirement is a hard floor on approval: if the
  // credited hours (after any deflation) don't clear it, this can't be
  // approved , the reviewer has to request changes instead.
  if (linkedTrial?.min_hours != null && creditHours < Number(linkedTrial.min_hours)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        `Credited hours (${creditHours}h) are below "${linkedTrial.name}"'s ${linkedTrial.min_hours}h minimum , use Request Changes instead, or credit at least ${linkedTrial.min_hours}h.`,
      )}`,
    );
  }

  const { data: project, error } = await db
    .from("projects")
    .update({
      status: "approved",
      review_note: note,
      review_note_by: reviewer,
      approved_hours: approvedHours,
      reviewing_by: "",
      reviewing_at: null,
    })
    .eq("id", projectId)
    .in("status", ["shipped", "second_review"])
    .select("id, name, user_id, project_type")
    .single();
  if (error || !project) {
    console.error("reviewProject (approve) failed", error?.message);
    return;
  }
  await insertReviewAudit(formData, projectId, project.user_id, by, "approved", note, claimedHours, approvedHours);

  if (stage === "second_review") await settleFirstPassPayouts(projectId, project.name);
  if (!own) await recordSettledPayout(projectId, access, "approved", project.name);

  // Collected up front so each beneficiary's referral check can see who else
  // is being credited on this same project , see the referrerRidingAlong
  // guard in creditBeneficiary.
  const { data: collabRows } = await db
    .from("project_collaborators")
    .select("id, user_id, hackatime_seconds")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const collaborators = (collabRows ?? []) as { id: number; user_id: string; hackatime_seconds: number | null }[];
  const allBeneficiaryIds = [project.user_id, ...collaborators.map((c) => c.user_id)];

  // One tier per project, applied to everyone credited on it. Re-read rather
  // than trusting the form value, since the tier update above is what actually
  // decides it.
  const { data: tierRow } = await db
    .from("projects")
    .select("level")
    .eq("id", projectId)
    .maybeSingle();
  const tierUsed = Math.min(Math.max(Number(tierRow?.level) || 1, 1), 4);

  // A Trial ship pays one way or the other, never both: the maker picks the
  // Trial prize or the pixels once it's approved. Until they've picked the
  // pixels, the payout is held rather than credited. Only the owner's pixels
  // are held , collaborators are paid for their hours either way.
  const trialChoice = String(current.trial_reward_choice ?? "");
  const holdForTrial = !!linkedTrial && trialChoice !== "pixels";
  // Hardware funding: only the owner's own payout gets docked , collaborators
  // are paid their hours in full, same as the Trial hold above.
  const fundingUsd = current.needs_funding ? Math.max(Number(current.funding_usd) || 0, 0) : 0;

  const ownerPayout = await creditBeneficiary(
    project.user_id,
    project.id,
    project.project_type,
    creditHours,
    current.shipped_at,
    by,
    collaborators.map((c) => c.user_id),
    tierUsed,
    holdForTrial,
    fundingUsd,
  );
  const { totalPx, deltaPx, pxRate, xpBefore, goalNote, referralNote, alreadyPx, goalMult, fundingPx } = ownerPayout;
  if (fundingPx > 0) {
    const { error: fundingErr } = await db
      .from("projects")
      .update({ funding_deducted_px: fundingPx })
      .eq("id", projectId);
    if (fundingErr) console.error("reviewProject (funding deduct)", fundingErr.message);
  }

  const trialPrize = linkedTrial ? await trialPrizeFor(linkedTrial) : null;

  // For a Trial ship, the prize "buys" the first min_hours of the project. Keep
  // that slice's pixel value so settlement can pay the prize AND the pixels for
  // everything beyond the minimum (see the trial-reward route in apps/server).
  // Clamped to the full payout so a short ship (hours <= min) yields 0 extra.
  const trialMinHours =
    linkedTrial && linkedTrial.min_hours != null ? Math.max(Number(linkedTrial.min_hours), 0) : 0;
  const trialPrizePx = linkedTrial
    ? Math.min(Math.max(Math.round(projectPayoutPx(trialMinHours, tierUsed, 0) * goalMult), 0), totalPx)
    : 0;

  const trialBeyondPx = Math.max(totalPx - trialPrizePx, 0);
  let credited: string;
  if (holdForTrial && trialChoice !== "item") {
    credited =
      `\n\nTrial "${linkedTrial!.name}" complete! You've earned "${trialPrize!.name}" for the first ` +
      `${trialMinHours}h, plus ${trialBeyondPx} pixels for the hours beyond that. Head to the project ` +
      `page to claim the prize (default), or skip it and take all ${totalPx} pixels instead.`;
  } else if (holdForTrial) {
    credited =
      `\n\nYou kept "${trialPrize!.name}" as your Trial reward on this one, plus the pixels for the hours past the ${trialMinHours}h minimum.`;
  } else if (alreadyPx > 0 && deltaPx > 0) {
    credited = `\n\n+${deltaPx} pixels for what's new (${totalPx} pixels total for this project , ${creditHours}h approved).`;
  } else if (alreadyPx > 0 && deltaPx <= 0) {
    credited = `\n\nNo new pixels this time , this project already earned ${alreadyPx} pixels.`;
  } else {
    credited =
      approvedHours !== null && approvedHours !== claimedHours
        ? `\n\n${totalPx} pixels credited (${approvedHours}h approved of ${claimedHours}h logged).`
        : `\n\n${totalPx} pixels credited for ${creditHours}h approved.`;
  }
  // The flat Trial bonus counts toward level and the community vault, but
  // deliberately not into pxRate above , the rate is meant to track the hours
  // actually worked.
  const trialBonusRe = linkedTrial ? config.economy.trialBonusRe : 0;
  const shipRe = ownerPayout.projectRe + trialBonusRe;
  const reLine =
    ` this ship earned ${Math.round(shipRe)} RE` +
    (trialBonusRe > 0 ? ` (${trialBonusRe} of it a Trial bonus)` : "") +
    `, putting you at level ${levelForRe(xpBefore + shipRe)}.`;
  if (deltaPx > 0 && !(holdForTrial && trialChoice === "item"))
    credited +=
      ` Your rate: ${Math.round(pxRate)} px/h ($${(pxRate * config.economy.pixelValueUsd).toFixed(2)}/hr) ,${reLine}`;
  else if (linkedTrial) credited += ` Either way,${reLine}`;
  if (goalNote && deltaPx > 0) credited += goalNote;
  if (referralNote && deltaPx > 0) credited += referralNote;
  if (fundingPx > 0)
    credited += ` $${fundingUsd.toFixed(2)} of that (${fundingPx} px) is going toward the hardware funding you requested instead of your wallet , the team will reach out about getting it to you.`;

  // Split payout: every accepted collaborator is credited independently at
  // their own rate tier for their own submitted hours slice (capped at what
  // they actually tracked, see claimedHoursForCollaborator).
  for (const c of collaborators) {
    const cClaimedHours = await claimedHoursForCollaborator(projectId, c.user_id, c.hackatime_seconds);
    const rawHours = Number(String(formData.get(`collabHours_${c.id}`) ?? cClaimedHours));
    const cCreditHours = Number.isFinite(rawHours)
      ? Math.min(cClaimedHours, Math.max(0, Math.round(rawHours * 10) / 10))
      : cClaimedHours;
    await db.from("project_collaborators").update({ approved_hours: cCreditHours }).eq("id", c.id);
    const cPayout = await creditBeneficiary(
      c.user_id,
      project.id,
      project.project_type,
      cCreditHours,
      current.shipped_at,
      by,
      allBeneficiaryIds.filter((id) => id !== c.user_id),
      tierUsed,
    );
    let cCredited: string;
    if (cPayout.alreadyPx > 0 && cPayout.deltaPx > 0) {
      cCredited = `\n\n+${cPayout.deltaPx} pixels for what's new (${cPayout.totalPx} pixels total for this project , ${cCreditHours}h approved).`;
    } else if (cPayout.alreadyPx > 0 && cPayout.deltaPx <= 0) {
      cCredited = `\n\nNo new pixels this time , you already earned ${cPayout.alreadyPx} pixels on this project.`;
    } else {
      cCredited = `\n\n${cPayout.totalPx} pixels credited for ${cCreditHours}h approved.`;
    }
    if (cPayout.deltaPx > 0)
      cCredited += ` Your rate: ${cPayout.pxRate} px/h ($${(cPayout.pxRate * config.economy.pixelValueUsd).toFixed(2)}/hr).`;
    if (cPayout.goalNote && cPayout.deltaPx > 0) cCredited += cPayout.goalNote;
    if (cPayout.referralNote && cPayout.deltaPx > 0) cCredited += cPayout.referralNote;
    await notifyOwner(
      c.user_id,
      "Project approved!",
      `"${project.name}" passed review , approved by ${reviewer}. Congrats on shipping!${cCredited}`,
    );
  }

  // Bounties the final reviewer ticked: fixed prize each, once per project,
  // only for projects shipped inside the bounty window.
  const bountyIds = [...new Set(formData.getAll("bountyIds").map(Number))].filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  for (const bid of bountyIds) {
    const { data: ev } = await db
      .from("events")
      .select("*")
      .eq("id", bid)
      .eq("type", "bounty")
      .is("stopped_at", null)
      .maybeSingle();
    if (!ev) continue;
    const bounty = ev as DashEventRow;
    const reward = Math.min(Math.max(Math.round(Number(bounty.config.reward) || 0), 0), 500);
    if (reward === 0) continue;
    if (
      !current.shipped_at ||
      current.shipped_at < bounty.starts_at ||
      current.shipped_at >= bounty.ends_at
    )
      continue;
    const { error: claimError } = await db.from("bounty_claims").insert({
      event_id: bid,
      project_id: projectId,
      user_id: project.user_id,
      pixels: reward,
      awarded_by: by,
    });
    if (claimError) continue;
    await db.rpc("adjust_user_pixels", {
      p_user_id: project.user_id,
      p_amount: reward,
      p_reason: "bounty",
      p_created_by: by,
    });
    credited += ` Bounty "${bounty.name}" met , +${reward} pixels!`;
    await logModAction(project.user_id, "bounty_awarded", `${bounty.name}: +${reward} pixels (${project.name})`, by);
  }

  // Trial payout: nothing is handed over here. The approval just opens the
  // choice (prize or the held pixels) and the player settles it themselves from
  // the project page , see the trial-reward route in apps/server. Re-approvals
  // of an already-settled Trial ship leave the choice alone.
  if (holdForTrial && trialChoice !== "item") {
    const { error: choiceError } = await db
      .from("projects")
      .update({ trial_reward_choice: "pending", trial_held_px: totalPx, trial_prize_px: trialPrizePx })
      .eq("id", projectId);
    if (choiceError) console.error("reviewProject (trial choice)", choiceError.message);
    else
      await logModAction(
        project.user_id,
        "trial_reward_pending",
        `${linkedTrial!.name}: ${trialPrize!.name} or ${totalPx} px (${project.name})`,
        by,
      );
  }

  await notifyOwner(
    project.user_id,
    "Project approved!",
    `"${project.name}" passed review , approved by ${playerFacingReviewer}. Congrats on shipping!\n\nReviewer note: ${note}${credited}`,
  );
  await logModAction(
    project.user_id,
    "project_approved",
    `${project.name}: ${deltaPx >= 0 ? "+" : ""}${deltaPx} pixels (total ${totalPx})`,
    by,
  );
  if (fundingPx > 0)
    await logModAction(
      project.user_id,
      "funding_deducted",
      `${project.name}: $${fundingUsd.toFixed(2)} hardware grant , ${fundingPx} px withheld from payout, needs fulfillment`,
      by,
    );
  // Fire-and-log: a failed Airtable push (bad address data, Airtable being
  // down, etc.) must never block the approval itself - the "Re-send to
  // Airtable" button on the project page is the fallback for that case.
  try {
    const airtableResult = await pushProjectToAirtable(projectId);
    if (!airtableResult.ok)
      console.error(`reviewProject: Airtable push failed for project ${projectId}`, airtableResult.error);
  } catch (err) {
    console.error(`reviewProject: Airtable push threw for project ${projectId}`, (err as Error).message);
  }
  const nextPath = await nextReviewPath(access, by, stage, projectId);
  revalidatePath("/review");
  redirect(nextPath);
}

// Reviewers can re-grade the difficulty level (L1–L4) a maker self-assigned.
export async function setProjectLevel(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const level = Number(formData.get("level") ?? 0);
  const back = `/review/${projectId}`;
  if (!projectId || !Number.isInteger(level) || level < 1 || level > 4) return;

  const { data: current } = await db
    .from("projects")
    .select("user_id, name, level")
    .eq("id", projectId)
    .single();
  if (!current) return;
  if (await isOwnProject(access, current.user_id))
    redirect(`${back}?error=${encodeURIComponent("You can't change the level of your own project.")}`);
  if (Number(current.level) === level) {
    revalidatePath(back);
    redirect(back);
  }

  const { error } = await db.from("projects").update({ level }).eq("id", projectId);
  if (error) {
    console.error("setProjectLevel failed", error.message);
    return;
  }
  await logModAction(
    current.user_id,
    "project_level_changed",
    `${current.name}: level set to L${level} (was L${current.level ?? 1})`,
    by,
  );
  revalidatePath(back);
  redirect(back);
}

// A reviewer can correct the hardware funding grant a maker asked for (e.g.
// the cart total didn't match, or an item got swapped out) before approving ,
// this is what the payout calculator and the approval-time deduction actually
// use, so it has to be settled before the verdict is submitted.
export async function updateFundingAmount(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const back = `/review/${projectId}`;
  if (!projectId) return;
  const raw = String(formData.get("fundingUsd") ?? "").trim();
  const amount = Math.min(Math.max(Number(raw) || 0, 0), 100000);
  if (!Number.isFinite(amount)) redirect(`${back}?error=${encodeURIComponent("Funding amount must be a number.")}`);

  const { data: current } = await db
    .from("projects")
    .select("user_id, name, needs_funding, funding_usd")
    .eq("id", projectId)
    .single();
  if (!current) return;
  if (!current.needs_funding)
    redirect(`${back}?error=${encodeURIComponent("This project didn't request hardware funding.")}`);

  const { error } = await db.from("projects").update({ funding_usd: amount }).eq("id", projectId);
  if (error) {
    console.error("updateFundingAmount failed", error.message);
    redirect(`${back}?error=${encodeURIComponent("Couldn't save the funding amount.")}`);
  }
  await logModAction(
    current.user_id,
    "funding_amount_changed",
    `${current.name}: funding set to $${amount.toFixed(2)} (was $${Number(current.funding_usd ?? 0).toFixed(2)})`,
    by,
  );
  revalidatePath(back);
  redirect(back);
}

// Undoes whatever referral side effects this specific project caused for a
// beneficiary, if any , counterpart to the boost/reward grants in
// creditBeneficiary. Without this, voiding a verdict clawed back the pixels
// but left the referrer holding a reward (and the referred player holding a
// spent boost slot) for a ship that turned out not to count.
async function reverseReferralForRevokedProject(
  userId: string,
  projectId: number,
  by: string,
): Promise<void> {
  const { data: referral } = await db
    .from("referrals")
    .select("id, referrer_id, boosted_ships, boost_project_id, rewarded_at, reward_pixels, reward_project_id")
    .eq("referred_id", userId)
    .maybeSingle();
  if (!referral) return;

  if (referral.boost_project_id === projectId) {
    await db
      .from("referrals")
      .update({ boosted_ships: Math.max(0, Number(referral.boosted_ships) - 1), boost_project_id: null })
      .eq("id", referral.id);
  }

  if (referral.reward_project_id === projectId && referral.rewarded_at) {
    await db
      .from("referrals")
      .update({ rewarded_at: null, reward_tier: null, reward_pixels: null, reward_project_id: null })
      .eq("id", referral.id);
    await db.rpc("adjust_user_pixels", {
      p_user_id: referral.referrer_id,
      p_amount: -(Number(referral.reward_pixels) || 0),
      p_reason: "referral_reward_reverted",
      p_created_by: by,
    });
    await db.from("notifications").insert({
      user_id: referral.referrer_id,
      title: "Referral reward reversed",
      body: "The ship that earned you a referral reward got sent back for another review, so that reward's on hold , it'll pay out again once a qualifying ship clears review.",
    });
  }
}

export async function reReviewProject(formData: FormData): Promise<void> {
  // Send back to review is a staff action , admins only (not plain reviewers).
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!projectId) return;

  const { data: project, error } = await db
    .from("projects")
    .update({ status: "shipped", review_note: "", review_note_by: "", approved_hours: null })
    .eq("id", projectId)
    .in("status", ["approved", "needs_changes"])
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("reReviewProject failed", error?.message);
    return;
  }

  const claimedHours = await claimedHoursFor(projectId);

  // The verdict is void, so the payout is too , claw back every pixel this
  // project was credited and leave the reversal in the ledger. Collaborators
  // were credited independently, so each gets their own clawback too.
  let revoked = await revokeProjectPixels(project.user_id, project.id, by);
  await reverseReferralForRevokedProject(project.user_id, project.id, by);
  // An unclaimed Trial reward goes back in the box with the verdict. One
  // already taken stays taken , the prize order is out the door by then.
  await db
    .from("projects")
    .update({ trial_reward_choice: "", trial_held_px: 0, trial_prize_px: 0 })
    .eq("id", projectId)
    .eq("trial_reward_choice", "pending");
  for (const collaboratorId of await acceptedCollaboratorUserIds(projectId)) {
    const collabRevoked = await revokeProjectPixels(collaboratorId, project.id, by);
    revoked += collabRevoked;
    await reverseReferralForRevokedProject(collaboratorId, project.id, by);
    if (collabRevoked > 0) {
      await db.from("notifications").insert({
        user_id: collaboratorId,
        title: "Project back in review",
        body: `"${project.name}" is getting another look from the review team. The ${collabRevoked} pixels it earned you are on hold until the new verdict.`,
      });
    }
  }

  await logModAction(
    project.user_id,
    "review_reverted",
    `${project.name}: verdict reverted, back in the review queue${
      revoked > 0 ? ` , ${revoked} pixels revoked` : ""
    }`,
    by,
  );
  const { error: auditError } = await db.from("review_audits").insert({
    project_id: projectId,
    user_id: project.user_id,
    reviewer: by,
    verdict: "reverted",
    note: "Previous verdict reverted , project returned to the review queue.",
    audit_note: "",
    claimed_hours: claimedHours,
  });
  if (auditError) console.error("re-review audit insert failed", auditError.message);

  const { error: notifyError } = await db.from("notifications").insert({
    user_id: project.user_id,
    title: "Project back in review",
    body: `"${project.name}" is getting another look from the review team.${
      revoked > 0
        ? ` The ${revoked} pixels it earned are on hold until the new verdict.`
        : ""
    } You'll hear back here soon , nothing needed from you.`,
  });
  if (notifyError) console.error("re-review notification failed", notifyError.message);
  revalidatePath("/", "layout");
}

// A final reviewer correcting the player-facing title/description/image ,
// these are the exact same columns the player's own project page and the
// YSWS/Airtable export CSV read live, so this is a fix everywhere with no
// separate sync step, and it applies immediately, independent of a verdict
// (previously these fields only saved alongside reviewProject's own verdict
// submit , split out so a reviewer doesn't have to also decide a verdict
// just to fix a typo in the title). Optional: absent or unchanged fields are
// left alone.
export async function applySubmissionEdits(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const back = `/review/${projectId}`;
  if (!projectId) return;
  if (!access.canSecondPass)
    redirect(`${back}?error=${encodeURIComponent("Only a final reviewer can edit the submission.")}`);

  const { data: current } = await db
    .from("projects")
    .select("name, description, image_url, user_id")
    .eq("id", projectId)
    .single();
  if (!current) return;

  const editedName = String(formData.get("editedName") ?? "").trim().slice(0, 200);
  const editedDescription = String(formData.get("editedDescription") ?? "").trim().slice(0, 5000);
  const editedImageUrl = String(formData.get("editedImageUrl") ?? "").trim();
  const edits: Record<string, string> = {};
  if (editedName && editedName !== current.name) edits.name = editedName;
  if (editedDescription && editedDescription !== current.description) edits.description = editedDescription;
  if (editedImageUrl && editedImageUrl !== current.image_url) {
    try {
      await assertSafeExternalUrl(editedImageUrl);
    } catch (e) {
      redirect(`${back}?error=${encodeURIComponent(`Image URL: ${(e as Error).message}`)}`);
    }
    edits.image_url = editedImageUrl;
  }
  if (Object.keys(edits).length === 0)
    redirect(`${back}?error=${encodeURIComponent("No changes to apply.")}`);

  const { error } = await db.from("projects").update(edits).eq("id", projectId);
  if (error) {
    console.error("applySubmissionEdits failed", error.message);
    redirect(`${back}?error=${encodeURIComponent("Failed to save , try again.")}`);
  }
  await logModAction(
    current.user_id,
    "project_edited",
    `${edits.name ?? current.name}: final reviewer edited ${Object.keys(edits).join(", ")}`,
    by,
  );
  revalidatePath(`/review/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
}

// A final reviewer looking at a second_review project isn't confident enough
// to confirm or overturn the first pass , send it back to the front of the
// 'shipped' queue for a fresh first-pass look instead of forcing a verdict.
// The first-pass reviewer's pending payout only gets voided if this was THEIR
// mistake (a checkbox on the form) , otherwise it's paid out in full, same as
// a normal confirmed first pass, since it's not fair to dock them for
// something outside their control (flaky demo, ambiguous scope, etc).
// Distinct from reReviewProject, which reopens a project that already got a
// FINAL verdict.
export async function sendBackToFirstPass(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const voidPayout = formData.get("voidPayout") === "1";
  const back = `/review/${projectId}`;
  if (!projectId) return;
  if (!access.canSecondPass)
    redirect(`${back}?error=${encodeURIComponent("Only a final reviewer can send a project back to first pass.")}`);
  if (!reason)
    redirect(`${back}?error=${encodeURIComponent("Say why you're sending this back to first pass.")}`);

  const { data: current } = await db
    .from("projects")
    .select("status, user_id, name")
    .eq("id", projectId)
    .single();
  if (!current) return;
  if (current.status !== "second_review")
    redirect(`${back}?error=${encodeURIComponent("This project isn't awaiting a final pass.")}`);

  const { data: project, error } = await db
    .from("projects")
    .update({
      status: "shipped",
      review_note: "",
      review_note_by: "",
      approved_hours: null,
      reviewing_by: "",
      reviewing_at: null,
      first_pass_by: "",
      first_pass_at: null,
      first_pass_note: "",
      first_pass_hours: null,
      first_pass_verdict: null,
    })
    .eq("id", projectId)
    .eq("status", "second_review")
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("sendBackToFirstPass failed", error?.message);
    return;
  }

  if (voidPayout) await voidFirstPassPayouts(projectId);
  else await settleFirstPassPayouts(projectId, project.name);

  const claimedHours = await claimedHoursFor(projectId);
  const { error: auditError } = await db.from("review_audits").insert({
    project_id: projectId,
    user_id: project.user_id,
    reviewer: by,
    verdict: "sent_to_first_pass",
    note: reason,
    audit_note: "",
    claimed_hours: claimedHours,
  });
  if (auditError) console.error("send-back audit insert failed", auditError.message);

  await logModAction(
    project.user_id,
    "project_sent_to_first_pass",
    `${project.name}: back at the front of the queue, first-pass payout ${voidPayout ? "voided" : "paid in full"} , ${reason}`,
    by,
  );
  revalidatePath("/review");
  redirect("/review");
}

// Escape hatch for a project Joe never scores, or one that could not be
// submitted at all. Only a final reviewer, always logged, always with a reason.
export async function forceAdvanceFraud(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  if (!access.canSecondPass)
    redirect(`/review?error=${encodeURIComponent("Only a final reviewer can skip the fraud pass.")}`);
  const projectId = Number(formData.get("projectId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const back = `/review/${projectId}`;
  if (!projectId) redirect("/review");
  if (!reason)
    redirect(`${back}?error=${encodeURIComponent("Give a reason for skipping the fraud pass.")}`);

  const { data: project, error } = await db
    .from("projects")
    .update({ status: "second_review" })
    .eq("id", projectId)
    .eq("status", "fraud_review")
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    redirect(`${back}?error=${encodeURIComponent("This project isn't waiting on fraud review.")}`);
  }

  await logModAction(
    project.user_id as string,
    "project_fraud_override",
    `${project.name}: skipped the fraud pass , ${reason}`,
    actorName(access),
  );
  revalidatePath("/review");
  redirect(back);
}

// Manual pixel correction from the Pixels tab. Deducts (or grants) whole
// pixels with a mandatory reason; owners only, everything lands in the ledger.
export async function adjustPixels(formData: FormData): Promise<void> {
  const access = await requirePerm("pixels");
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "").trim();
  const amount = Math.round(Number(formData.get("amount") ?? 0));
  const deduct = formData.get("mode") !== "grant";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!userId || !Number.isFinite(amount) || amount <= 0)
    redirect(`/pixels?error=${encodeURIComponent("Pick a player and a whole number of pixels.")}`);
  if (!reason)
    redirect(`/pixels?error=${encodeURIComponent("A reason is required for manual pixel changes.")}`);
  const delta = deduct ? -amount : amount;
  const { error } = await db.rpc("adjust_user_pixels", {
    p_user_id: userId,
    p_amount: delta,
    p_reason: deduct ? "manual_deduction" : "manual_grant",
    p_created_by: `${by} , ${reason}`,
  });
  if (error) {
    console.error("adjustPixels failed", error.message);
    redirect(`/pixels?error=${encodeURIComponent("Couldn't adjust pixels , try again.")}`);
  }
  await logModAction(
    userId,
    deduct ? "pixels_deducted" : "pixels_granted",
    `${deduct ? "-" : "+"}${amount} pixels , ${reason}`,
    by,
  );
  const title = deduct ? "Pixels deducted" : "Pixels granted";
  const body = `${deduct ? `${amount} pixels were removed from` : `${amount} pixels were added to`} your balance by the Pixl team.\n\nReason: ${reason}\n\nIf you think this is a mistake, contact the Pixl team.`;
  const { error: notifyError } = await db
    .from("notifications")
    .insert({ user_id: userId, title, body });
  if (notifyError) console.error("adjustPixels notification failed", notifyError.message);

  await dmOrEmail(userId, title, body);
  revalidatePath("/pixels");
  redirect("/pixels?adjusted=1");
}

export async function archiveProject(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const unarchive = formData.get("unarchive") === "1";
  if (!projectId) return;
  const { data: project, error } = await db
    .from("projects")
    .update({ archived_at: unarchive ? null : new Date().toISOString() })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("archiveProject failed", error?.message);
    return;
  }
  await logModAction(
    project.user_id,
    unarchive ? "project_unarchived" : "project_archived",
    project.name,
    by,
  );
  revalidatePath("/", "layout");
}

// Manual, one-project-at-a-time push into the intermediate YSWS Airtable
// base. Never flips that base's own "Automation - Submit to Unified"
// checkbox - a teammate does that by hand after reviewing what lands here.
// Re-running this (e.g. the "Re-send to Airtable" button) updates the same
// row via the stored airtable_record_id instead of creating a duplicate -
// but an update ship clears that id at ship time (see the ship handler in
// apps/server/src/routes/projects.ts), so its eventual approval pushes a
// genuinely NEW row instead of overwriting the original ship's row.
// Shared by the automatic push on final approval (see reviewProject) and the
// manual "Send to Airtable" / "Re-send to Airtable" button on the project
// page - one place owns the field-building/push logic so the two callers
// can't drift apart.
async function pushProjectToAirtable(projectId: number): Promise<{ ok: boolean; error?: string }> {
  const { data: project, error: projectError } = await db
    .from("projects")
    .select(
      "id, status, banned_at, rejected_at, repo_url, demo_url, description, image_url, approved_hours, system_note, user_id, airtable_record_id, hackatime_projects",
    )
    .eq("id", projectId)
    .single();
  if (projectError || !project) return { ok: false, error: "Project not found." };
  if (project.status !== "approved" || project.banned_at || project.rejected_at)
    return { ok: false, error: "Only approved projects can be sent to Airtable." };

  const { data: user, error: userError } = await db
    .from("users")
    .select(
      "first_name, last_name, real_name, email, birthday, address_line1, address_line2, address_city, address_state, address_country, address_postal, slack_id, hackatime_token",
    )
    .eq("id", project.user_id)
    .maybeSingle();
  if (userError) return { ok: false, error: "Could not look up this project's owner - try again." };

  const [fallbackFirst, ...fallbackRest] = (user?.real_name ?? "").split(" ");
  const firstName = user?.first_name || fallbackFirst || "";
  const lastName = user?.last_name || fallbackRest.join(" ") || "";

  const { data: audit, error: auditError } = await db
    .from("review_audits")
    .select("audit_note")
    .eq("project_id", projectId)
    .eq("verdict", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (auditError) return { ok: false, error: "Could not look up the approval note - try again." };
  const auditSections = parseAuditNote(audit?.audit_note ?? "");

  const hackatimeReport = await fetchHackatimeReport(
    user?.slack_id,
    user?.hackatime_token ?? null,
    project.hackatime_projects ?? [],
  );
  // "hackatime-project 7/20/2026-7/22/2026, hackatime-project-2 7/21/2026-7/23/2026" -
  // Airtable's own format for this field (see its field description), not the
  // codebase's usual "Jul 18" Intl.DateTimeFormat style used elsewhere.
  const fmtDate = (unixSeconds: number) => {
    const d = new Date(unixSeconds * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  };
  const hackatimeProjectDateRanges = hackatimeReport.projects
    .filter((p) => p.linked && p.firstActivity != null && p.lastActivity != null)
    .map((p) => `${p.name} ${fmtDate(p.firstActivity!)}-${fmtDate(p.lastActivity!)}`)
    .join(", ");
  const lapseLinks = hackatimeReport.projects
    .flatMap((p) => p.lapses)
    .map((l) => l.playbackUrl)
    .filter((url): url is string => !!url)
    .join(", ");

  const fields = buildAirtableFields({
    repoUrl: project.repo_url ?? "",
    demoUrl: project.demo_url ?? "",
    firstName,
    lastName,
    email: user?.email ?? "",
    imageUrl: project.image_url ?? "",
    description: project.description ?? "",
    approvedHours: project.approved_hours,
    systemNote: project.system_note ?? "",
    birthday: decryptPII(user?.birthday),
    addressLine1: decryptPII(user?.address_line1),
    addressLine2: decryptPII(user?.address_line2),
    city: decryptPII(user?.address_city),
    state: decryptPII(user?.address_state),
    country: decryptPII(user?.address_country),
    zip: decryptPII(user?.address_postal),
    auditSections,
    hackatimeProjectDateRanges,
    submitterHackatimeId: hackatimeReport.hackatimeUserId,
    lapseLinks,
  });

  const result = await pushProjectRecord(fields, project.airtable_record_id ?? null);
  // result.error comes from Airtable's own API error message or a network
  // failure reason - never from decrypted PII, so it's safe to show/log.
  if (!result.ok) return { ok: false, error: `Airtable push failed: ${result.error}` };

  const { error: updateError } = await db
    .from("projects")
    .update({ airtable_record_id: result.recordId })
    .eq("id", projectId);
  if (updateError) {
    console.error("pushProjectToAirtable: airtable_record_id save failed", updateError.message);
    return {
      ok: false,
      error:
        "Pushed to Airtable, but failed to save the record link - check Airtable for a duplicate before pushing again.",
    };
  }
  return { ok: true };
}

export async function sendProjectToAirtable(formData: FormData): Promise<void> {
  await requirePerm("ban");
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!projectId) return;
  const back = `/projects/${projectId}`;

  const result = await pushProjectToAirtable(projectId);
  if (!result.ok) {
    redirect(`${back}?error=${encodeURIComponent(result.error ?? "Airtable push failed.")}`);
  }

  revalidatePath(back);
}

// Any reviewer can nominate a project as a "Beacon" - a cosmetic badge shown
// wherever the project is displayed publicly (explore, project page), never
// a payout/pixel effect. Gated on "review" rather than "ban", unlike the
// staff actions above, since this is a grading call any reviewer can make.
// Internal name (isPeak, is_peak, project_peak_marked) stays as-is, this is
// a display rename only, not worth a DB migration.
export async function toggleProjectPeak(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const isPeak = formData.get("isPeak") === "1";
  if (!projectId) return;
  const { data: project, error } = await db
    .from("projects")
    .update({ is_peak: isPeak })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("toggleProjectPeak failed", error?.message);
    return;
  }
  await logModAction(
    project.user_id,
    isPeak ? "project_peak_marked" : "project_peak_unmarked",
    project.name,
    by,
  );
  revalidatePath("/", "layout");
}

// Normally only hours from hackatimeCutoffUnix onward count (see
// HACKATIME_CUTOFF in apps/server). Some projects are legitimately started
// earlier and picked back up , this lets a reviewer re-pull the player's
// Hackatime spans from an earlier date for this one project and recredit
// hackatime_seconds accordingly. Requires a note so it's auditable, and only
// raises the stored total (never used to quietly lower it, ReviewForm's own
// "credited hours" field already covers lowering).
export async function extendHoursCutoff(formData: FormData): Promise<void> {
  const access = await requirePerm("review");
  const by = actorName(access);
  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);
  const projectId = Number(formData.get("projectId") ?? 0);
  const sinceRaw = String(formData.get("since") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const back = `/review/${projectId}`;
  if (!projectId) return;
  if (!note)
    redirect(`${back}?error=${encodeURIComponent("A note is required to extend the hours cutoff.")}`);

  const since = new Date(sinceRaw);
  if (isNaN(since.getTime()) || since.getTime() >= hackatimeCutoffUnix * 1000)
    redirect(
      `${back}?error=${encodeURIComponent(`Pick a date before the ${hackatimeCutoffLabel} cutoff.`)}`,
    );
  const sinceUnix = Math.floor(since.getTime() / 1000);

  const { data: project } = await db
    .from("projects")
    .select("user_id, name, status, hackatime_projects, hackatime_seconds")
    .eq("id", projectId)
    .single();
  if (!project) return;
  if (await isOwnProject(access, project.user_id))
    redirect(`${back}?error=${encodeURIComponent("You can't act on your own project.")}`);
  if (project.status !== "shipped" && project.status !== "second_review")
    redirect(`${back}?error=${encodeURIComponent("This project isn't in the review queue.")}`);

  const { data: owner } = await db
    .from("users")
    .select("slack_id, hackatime_token")
    .eq("id", project.user_id)
    .single();
  const linked = (project.hackatime_projects as string[]) ?? [];
  const newSeconds = await fetchTrackedSecondsSince(
    (owner as { slack_id?: string } | null)?.slack_id ?? null,
    (owner as { hackatime_token?: string } | null)?.hackatime_token ?? null,
    linked,
    sinceUnix,
  );
  if (newSeconds === null)
    redirect(`${back}?error=${encodeURIComponent("Couldn't reach Hackatime, try again.")}`);
  const currentSeconds = Number(project.hackatime_seconds) || 0;
  if (newSeconds <= currentSeconds)
    redirect(
      `${back}?error=${encodeURIComponent("Hackatime didn't return more hours than already credited , nothing changed.")}`,
    );

  const { error } = await db
    .from("projects")
    .update({
      hackatime_seconds: newSeconds,
      hours_extended_since: since.toISOString(),
      hours_extended_by: reviewer,
      hours_extended_note: note,
    })
    .eq("id", projectId);
  if (error) {
    console.error("extendHoursCutoff failed", error.message);
    redirect(`${back}?error=${encodeURIComponent("Failed to save , try again.")}`);
  }
  await logModAction(
    project.user_id,
    "project_hours_extended",
    `${project.name}: counted hours from ${since.toISOString().slice(0, 10)} (${Math.round(currentSeconds / 3600)}h -> ${Math.round(newSeconds / 3600)}h) , ${note}`,
    by,
  );
  revalidatePath(back);
  redirect(back);
}

export async function rejectProject(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const returnTo = String(formData.get("returnTo") ?? "") || `/projects/${projectId}`;
  if (!projectId) return;
  if (!reason)
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("A reason is required to reject a project.")}`);

  const { data: target } = await db.from("projects").select("user_id").eq("id", projectId).single();
  if (target && (await isOwnProject(access, target.user_id)))
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("You can't act on your own project.")}`);

  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);

  const { data: project, error } = await db
    .from("projects")
    .update({
      rejected_at: new Date().toISOString(),
      reject_reason: reason,
      reject_by: reviewer,
    })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("rejectProject failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "project_rejected", `${project.name}: ${reason}`, by);

  const body = `Your project "${project.name}" was rejected by ${reviewer} and removed from Pixl.\n\nReason: ${reason}\n\nIf you think this is a mistake, contact the Pixl team.`;
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: project.user_id,
    title: "Project rejected",
    body,
  });
  if (notifyError) console.error("reject notification failed", notifyError.message);

  await dmOrEmail(project.user_id, "Project rejected", body);
  revalidatePath("/", "layout");
}

export async function unrejectProject(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!projectId) return;
  const { data: project, error } = await db
    .from("projects")
    .update({ rejected_at: null, reject_reason: "", reject_by: "" })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("unrejectProject failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "project_unrejected", project.name, by);
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: project.user_id,
    title: "Project restored",
    body: `"${project.name}" was restored and is visible again. Sorry for the mix-up!`,
  });
  if (notifyError) console.error("unreject notification failed", notifyError.message);
  revalidatePath("/", "layout");
}

export async function banProject(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const returnTo = String(formData.get("returnTo") ?? "") || `/projects/${projectId}`;
  if (!projectId) return;
  if (!reason)
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("A reason is required to ban a project.")}`);

  const { data: target } = await db.from("projects").select("user_id").eq("id", projectId).single();
  if (target && (await isOwnProject(access, target.user_id)))
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("You can't act on your own project.")}`);

  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);

  const { data: project, error } = await db
    .from("projects")
    .update({
      banned_at: new Date().toISOString(),
      ban_reason: reason,
      ban_by: reviewer,
    })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("banProject failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "project_banned", `${project.name}: ${reason}`, by);

  const body = `Your project "${project.name}" was permanently banned by ${reviewer} and can no longer be shipped to Pixl.\n\nReason: ${reason}\n\nIf you think this is a mistake, contact the Pixl team.`;
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: project.user_id,
    title: "Project banned",
    body,
  });
  if (notifyError) console.error("ban notification failed", notifyError.message);

  await dmOrEmail(project.user_id, "Project banned", body);
  revalidatePath("/", "layout");
}

export async function unbanProject(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!projectId) return;
  const { data: project, error } = await db
    .from("projects")
    .update({ banned_at: null, ban_reason: "", ban_by: "" })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("unbanProject failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "project_unbanned", project.name, by);
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: project.user_id,
    title: "Project ban lifted",
    body: `The ban on "${project.name}" was lifted. You can ship it again. Sorry for the mix-up!`,
  });
  if (notifyError) console.error("unban notification failed", notifyError.message);
  revalidatePath("/", "layout");
}

// Super-admin-only hold on a project's review: blocks submitting any verdict
// (first pass, final pass, extend cutoff, send back, ban) while set, but the
// project stays visible in the queue as normal. No expiry - stays held until
// a super admin explicitly releases it, requireSuper() gates both directions
// so any super admin can, not just whoever set it.
export async function holdReview(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const returnTo = String(formData.get("returnTo") ?? "") || `/review/${projectId}`;
  if (!projectId) return;
  if (!reason)
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("A reason is required to hold a review.")}`);

  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);
  const { data: project, error } = await db
    .from("projects")
    .update({
      hold_at: new Date().toISOString(),
      hold_by: reviewer,
      hold_reason: reason,
    })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("holdReview failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "review_held", `${project.name}: ${reason}`, by);
  revalidatePath(`/review/${projectId}`);
  revalidatePath("/review");
}

export async function releaseReviewHold(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const by = actorName(access);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!projectId) return;
  const { data: project, error } = await db
    .from("projects")
    .update({ hold_at: null, hold_by: "", hold_reason: "" })
    .eq("id", projectId)
    .select("id, name, user_id")
    .single();
  if (error || !project) {
    console.error("releaseReviewHold failed", error?.message);
    return;
  }
  await logModAction(project.user_id, "review_hold_released", project.name, by);
  revalidatePath(`/review/${projectId}`);
  revalidatePath("/review");
}

// Keeps an active review's claim (reviewing_by/reviewing_at, see claimReview
// and REVIEW_LOCK_MS in lib/db.ts) alive while the reviewer is actually still
// on the detail page - called periodically by the ReviewHeartbeat client
// component. Only ever refreshes a claim the caller already holds (the
// reviewing_by match), so it can neither steal someone else's claim nor
// resurrect one that already expired and was picked up by someone else.
export async function heartbeatReview(projectId: number): Promise<void> {
  const access = await requirePerm("review");
  if (!projectId) return;
  await db
    .from("projects")
    .update({ reviewing_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("reviewing_by", access.session.slackId);
}

export async function banIdea(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const ideaId = Number(formData.get("ideaId") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const returnTo = String(formData.get("returnTo") ?? "") || "/ideas";
  if (!ideaId) return;
  if (!reason)
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent("A reason is required to ban an idea.")}`);

  const reviewer = await reviewerLabel(access.session.slackId, access.session.name);

  const { data: idea, error } = await db
    .from("ideas")
    .update({
      banned_at: new Date().toISOString(),
      ban_reason: reason,
      ban_by: reviewer,
    })
    .eq("id", ideaId)
    .select("id, title, user_id")
    .single();
  if (error || !idea) {
    console.error("banIdea failed", error?.message);
    return;
  }
  await logModAction(idea.user_id, "idea_banned", `${idea.title}: ${reason}`, by);
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: idea.user_id,
    title: "Idea removed",
    body: `Your idea "${idea.title}" was removed by ${reviewer}.\n\nReason: ${reason}\n\nIf you think this is a mistake, contact the Pixl team.`,
  });
  if (notifyError) console.error("idea ban notification failed", notifyError.message);
  revalidatePath("/ideas");
}

export async function unbanIdea(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const ideaId = Number(formData.get("ideaId") ?? 0);
  if (!ideaId) return;
  const { data: idea, error } = await db
    .from("ideas")
    .update({ banned_at: null, ban_reason: "", ban_by: "" })
    .eq("id", ideaId)
    .select("id, title, user_id")
    .single();
  if (error || !idea) {
    console.error("unbanIdea failed", error?.message);
    return;
  }
  await logModAction(idea.user_id, "idea_unbanned", idea.title, by);
  const { error: notifyError } = await db.from("notifications").insert({
    user_id: idea.user_id,
    title: "Idea restored",
    body: `Your idea "${idea.title}" was restored. Sorry for the mix-up!`,
  });
  if (notifyError) console.error("idea unban notification failed", notifyError.message);
  revalidatePath("/ideas");
}

export async function banPlayer(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const hours = Number(formData.get("hours") ?? 0);
  if (!userId || !reason) return;

  const expiresAt =
    hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
  const { error } = await db.from("bans").insert({
    user_id: userId,
    reason,
    banned_by: by,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  await logModAction(
    userId,
    "ban",
    expiresAt ? `${hours}h , ${reason}` : `permanent , ${reason}`,
    by,
  );

  const lines = [
    expiresAt
      ? `You've been temporarily banned from Pixl until ${new Date(expiresAt).toUTCString()}.`
      : "You've been permanently banned from Pixl.",
  ];
  if (reason) lines.push(`Reason: ${reason}`);
  lines.push("If you believe this is a mistake, reach out to the Pixl team.");
  await dmOrEmail(userId, "Banned from Pixl", lines.join("\n\n"));
  revalidatePath("/", "layout");
}

// Everyone who can confirm a ban proposal: super admins (env owners and the
// super_admins table both) plus sub-admins explicitly holding the "ban"
// permission.
async function banConfirmerSlackIds(): Promise<string[]> {
  const [admins, supers] = await Promise.all([listAdmins(), listSuperAdmins()]);
  const withBanPerm = admins.filter((a) => a.permissions.includes("ban")).map((a) => a.slack_id);
  return [
    ...new Set([...ownerSlackIds(), ...supers.map((s) => s.slack_id), ...withBanPerm]),
  ];
}

// Moderators can't ban directly , they propose one, and an admin/owner with
// the "ban" permission confirms or rejects it (see confirmBanProposal /
// rejectBanProposal below).
export async function proposeBan(formData: FormData): Promise<void> {
  const session = await requireModerator();
  const by = `${session.name} (${session.slackId})`;
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const hours = Number(formData.get("hours") ?? 0);
  if (!userId || !reason) return;
  await insertBanProposal(userId, reason, hours, by);
  await logModAction(userId, "ban_proposed", hours > 0 ? `${hours}h , ${reason}` : `permanent , ${reason}`, by);

  const { data: player } = await db
    .from("users")
    .select("display_name, real_name")
    .eq("id", userId)
    .maybeSingle();
  const playerName = playerLabel(player, userId);
  const durationText = hours > 0 ? `${hours}h` : "permanent";
  const text = `${session.name} proposed a ${durationText} ban for ${playerName}: ${reason}\n\nReview it: ${DASH_URL}/bans`;
  const confirmers = await banConfirmerSlackIds();
  await Promise.all(
    confirmers.map((slackId) =>
      dmUser(slackId, text).catch((e) =>
        console.error("ban proposal DM failed", slackId, (e as Error).message),
      ),
    ),
  );

  revalidatePath("/reports");
  revalidatePath("/bans");
}

export async function confirmBanProposal(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const proposal = await getBanProposal(id);
  if (!proposal || proposal.status !== "pending") return;

  const expiresAt =
    proposal.hours > 0 ? new Date(Date.now() + proposal.hours * 3600_000).toISOString() : null;
  const { data: inserted, error } = await db
    .from("bans")
    .insert({ user_id: proposal.user_id, reason: proposal.reason, banned_by: by, expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "ban insert failed");

  await decideBanProposal(id, "confirmed", by, inserted.id as number);
  await logModAction(
    proposal.user_id,
    "ban",
    `${expiresAt ? `${proposal.hours}h` : "permanent"} , ${proposal.reason} (proposed by ${proposal.proposed_by})`,
    by,
  );

  const lines = [
    expiresAt
      ? `You've been temporarily banned from Pixl until ${new Date(expiresAt).toUTCString()}.`
      : "You've been permanently banned from Pixl.",
  ];
  if (proposal.reason) lines.push(`Reason: ${proposal.reason}`);
  lines.push("If you believe this is a mistake, reach out to the Pixl team.");
  await dmOrEmail(proposal.user_id, "Banned from Pixl", lines.join("\n\n"));
  revalidatePath("/", "layout");
  revalidatePath("/bans");
}

export async function rejectBanProposal(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const proposal = await getBanProposal(id);
  if (!proposal || proposal.status !== "pending") return;
  await decideBanProposal(id, "rejected", by);
  await logModAction(proposal.user_id, "ban_rejected", `proposed by ${proposal.proposed_by}`, by);
  revalidatePath("/bans");
}

export async function liftBan(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  const now = new Date().toISOString();
  const { data: lifted, error } = await db
    .from("bans")
    .update({ lifted_at: now })
    .eq("user_id", userId)
    .is("lifted_at", null)
    .select("id");
  if (error) throw new Error(error.message);

  const count = (lifted ?? []).length;
  await logModAction(userId, "unban", `${count} active ban(s) lifted`, by);

  if (count > 0) {
    await dmOrEmail(
      userId,
      "Ban lifted",
      [
        "Your ban from Pixl has been lifted. You're welcome to rejoin the game.",
        "Please keep the community guidelines in mind going forward.",
      ].join("\n\n"),
    );
  }
  revalidatePath("/", "layout");
}

// Mass moderation from the Players page: one action applied to every selected
// player, with the same guards, mod log entries and DMs as the single-player
// versions. Capped so a stray select-all can't nuke the whole playerbase.
export async function massPlayerAction(formData: FormData): Promise<void> {
  const action = String(formData.get("massAction") ?? "");
  const permFor: Record<string, Permission> = {
    warn: "warn",
    notify: "notify",
    ban: "ban",
    unban: "ban",
  };
  const perm = permFor[action];
  if (!perm) return;
  const access = await requirePerm(perm);
  const by = actorName(access);

  const back = String(formData.get("back") ?? "/players") || "/players";
  const fail = (msg: string) => redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  const ids = [...new Set(formData.getAll("userIds").map(String).filter(Boolean))];
  const message = String(formData.get("message") ?? "").trim().slice(0, 1000);
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  const hours = Number(formData.get("hours") ?? 0);

  if (ids.length === 0) fail("Select at least one player first.");
  if (ids.length > 100) fail("Mass actions are capped at 100 players at a time.");
  if (action === "ban" && !message) fail("A ban reason is required.");
  if (action === "notify" && !message) fail("A message is required to notify players.");

  if (action === "warn") {
    const text = message || DEFAULT_WARNING;
    for (const userId of ids) {
      await db.from("notifications").insert({
        user_id: userId,
        title: "Moderation warning",
        body: text,
      });
      await dmOrEmail(
        userId,
        "Moderation warning",
        [
          "You've received a moderation warning from Pixl.",
          text,
          "If you believe this is a mistake, reach out to the Pixl team.",
        ].join("\n\n"),
      );
      await logModAction(userId, "warn", `${text} (mass action, ${ids.length} players)`, by);
    }
  } else if (action === "notify") {
    const heading = title || "Message from the Pixl team";
    const { error } = await db
      .from("notifications")
      .insert(ids.map((userId) => ({ user_id: userId, title: heading, body: message })));
    if (error) throw new Error(error.message);
    for (const userId of ids)
      await logModAction(userId, "notify", `${heading} (mass action, ${ids.length} players)`, by);
  } else if (action === "ban") {
    const expiresAt =
      hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    for (const userId of ids) {
      const { error } = await db.from("bans").insert({
        user_id: userId,
        reason: message,
        banned_by: by,
        expires_at: expiresAt,
      });
      if (error) throw new Error(error.message);
      await logModAction(
        userId,
        "ban",
        `${expiresAt ? `${hours}h` : "permanent"} , ${message} (mass action, ${ids.length} players)`,
        by,
      );
      await dmOrEmail(
        userId,
        "Banned from Pixl",
        [
          expiresAt
            ? `You've been temporarily banned from Pixl until ${new Date(expiresAt).toUTCString()}.`
            : "You've been permanently banned from Pixl.",
          `Reason: ${message}`,
          "If you believe this is a mistake, reach out to the Pixl team.",
        ].join("\n\n"),
      );
    }
  } else if (action === "unban") {
    for (const userId of ids) {
      const { data: lifted, error } = await db
        .from("bans")
        .update({ lifted_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("lifted_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      if ((lifted ?? []).length === 0) continue;
      await logModAction(userId, "unban", `${(lifted ?? []).length} active ban(s) lifted (mass action)`, by);
      await dmOrEmail(
        userId,
        "Ban lifted",
        [
          "Your ban from Pixl has been lifted. You're welcome to rejoin the game.",
          "Please keep the community guidelines in mind going forward.",
        ].join("\n\n"),
      );
    }
  }

  revalidatePath("/", "layout");
  const verb = { warn: "Warned", notify: "Notified", ban: "Banned", unban: "Lifted bans for" }[action];
  redirect(
    `${back}${back.includes("?") ? "&" : "?"}done=${encodeURIComponent(
      `${verb} ${ids.length} player${ids.length === 1 ? "" : "s"}.`,
    )}`,
  );
}

export async function sendNotification(formData: FormData): Promise<void> {
  const access = await requirePerm("notify");
  const by = actorName(access);
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  const body = String(formData.get("body") ?? "").trim().slice(0, 500);
  const userId = String(formData.get("userId") ?? "").trim();
  const playerName = String(formData.get("playerName") ?? "").trim();
  const backTo = String(formData.get("backTo") ?? "");
  if (!title || !body) {
    if (backTo) redirect(`${backTo}?error=${encodeURIComponent("Title and message are required.")}`);
    return;
  }

  let targetId = userId;
  if (!targetId && playerName) {
    const likeName = playerName.replace(/[,()%*\\]/g, " ").trim();
    const { data } = await db
      .from("users")
      .select("id, display_name, real_name")
      .or(`display_name.ilike.${likeName},real_name.ilike.${likeName}`)
      .limit(2);
    if (!data || data.length !== 1) {
      if (backTo)
        redirect(
          `${backTo}?error=${encodeURIComponent(
            data && data.length > 1
              ? `Multiple players match "${playerName}" , be more specific.`
              : `No player named "${playerName}".`,
          )}`,
        );
      return;
    }
    targetId = data[0].id as string;
  }

  if (targetId) {
    const { error } = await db
      .from("notifications")
      .insert({ user_id: targetId, title, body });
    if (error) throw new Error(error.message);
    await logModAction(targetId, "notify", title, by);
    revalidatePath("/", "layout");
    if (backTo) redirect(`${backTo}?sent=1`);
    return;
  }

  const { data: users, error } = await db.from("users").select("id");
  if (error) throw new Error(error.message);
  const rows = (users ?? []).map((u) => ({ user_id: u.id as string, title, body }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await db
      .from("notifications")
      .insert(rows.slice(i, i + 500));
    if (insertError) throw new Error(insertError.message);
  }
  revalidatePath("/", "layout");
  if (backTo) redirect(`${backTo}?sent=${rows.length}`);
}

export interface PlayerHit {
  id: string;
  name: string;
  hasSlack: boolean;
}

// Typeahead for the notify page: find players by display name so an admin can
// pick one instead of guessing the exact spelling.
export async function searchPlayers(query: string): Promise<PlayerHit[]> {
  await requirePerm("notify");
  const clean = query.replace(/[%_,()\\]/g, " ").trim();
  if (clean.length < 2) return [];
  const { data, error } = await db
    .from("users")
    .select("id, display_name, real_name, slack_id")
    .or(`display_name.ilike.%${clean}%,real_name.ilike.%${clean}%`)
    .order("display_name", { ascending: true })
    .limit(8);
  if (error) {
    console.error("searchPlayers", error.message);
    return [];
  }
  return (data ?? []).map((u) => ({
    id: u.id as string,
    name: (u.real_name as string) || (u.display_name as string) || "(unnamed)",
    hasSlack: Boolean(u.slack_id),
  }));
}

function readSubadminPerms(formData: FormData, existing: string[]): string[] {
  const perms = formData
    .getAll("perms")
    .map(String)
    .filter((p) => (SUBADMIN_PERMISSIONS as readonly string[]).includes(p));
  if (existing.includes("review")) perms.push("review");
  if (existing.includes(NO_REVIEW)) perms.push(NO_REVIEW);
  if (existing.includes(SECOND_PASS)) perms.push(SECOND_PASS);
  if (existing.includes(SPONSOR)) perms.push(SPONSOR);
  return perms;
}

async function logTeamChange(
  slackId: string,
  name: string,
  action: string,
  before: string[],
  after: string[],
  actor: string,
  reason: string,
): Promise<void> {
  const { error } = await db.from("team_log").insert({
    slack_id: slackId,
    name,
    action,
    before,
    after,
    actor,
    reason,
  });
  if (error) console.error("team log insert failed", error.message);
}

// Set someone's team permissions: empty = off the team entirely. Every change
// lands in team_log so it can be undone.
async function setTeamPerms(
  slackId: string,
  name: string,
  permissions: string[],
  action: string,
  actor: string,
  addedBy?: string,
  reason = "",
): Promise<void> {
  const existing = await getAdmin(slackId);
  if (permissions.length === 0) {
    if (!existing) return;
    const { error } = await db.from("admins").delete().eq("slack_id", slackId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from("admins").upsert(
      {
        slack_id: slackId,
        name: name || existing?.name || slackId,
        permissions,
        added_by: existing?.added_by || addedBy || "",
      },
      { onConflict: "slack_id" },
    );
    if (error) throw new Error(error.message);
  }
  await logTeamChange(
    slackId,
    name || existing?.name || slackId,
    action,
    existing?.permissions ?? [],
    permissions,
    actor,
    reason,
  );
  revalidatePath("/", "layout");
}

// Super admins hold every permission and are the only role that can hand
// permissions out, promote other supers, or demote one. Env owners
// (ADMIN_SLACK_IDS) are supers too but have no table row, so they can't be
// demoted from here , that's deliberate, it's the lockout escape hatch.
export async function addSuperAdminAction(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!/^[UW][A-Z0-9]{6,}$/.test(slackId))
    redirect(
      `/admins?serror=${encodeURIComponent("Enter a valid Slack member ID (starts with U).")}`,
    );
  await addSuperAdmin(slackId, name, actorName(access));
  await logTeamChange(
    slackId,
    name || slackId,
    "super added",
    [],
    ["super admin"],
    actorName(access),
    "",
  );
  await dmTeam(
    slackId,
    [
      "You're a Pixl super admin now. 👑",
      "That's full access to the dashboard: every permission, plus the ability to grant permissions and promote other super admins.",
      `Sign in with Slack here: ${DASH_URL}`,
    ].join("\n\n"),
  );
  revalidatePath("/", "layout");
}

export async function removeSuperAdminAction(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!slackId || !reason) return;
  // Demoting yourself mid-session is the one move that can't be undone from
  // the UI afterwards , another super has to do it.
  if (slackId === access.session.slackId)
    redirect(
      `/admins?serror=${encodeURIComponent("You can't remove your own super admin access , ask another super admin.")}`,
    );
  const row = (await listSuperAdmins()).find((r) => r.slack_id === slackId);
  if (!row) return;
  await removeSuperAdmin(slackId);
  await logTeamChange(
    slackId,
    row.name || slackId,
    "super removed",
    ["super admin"],
    [],
    actorName(access),
    reason,
  );
  await dmRemoved(slackId, "Your Pixl super admin access has been removed.", reason);
  revalidatePath("/", "layout");
}

export async function addAdmin(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!slackId) return;
  const existing = await getAdmin(slackId);
  const perms = readSubadminPerms(formData, existing?.permissions ?? []);
  await setTeamPerms(
    slackId,
    name,
    perms,
    existing ? "updated" : "added",
    actorName(access),
    actorName(access),
  );
  if (!existing && perms.length > 0)
    await dmTeam(
      slackId,
      [
        "Welcome to the Pixl mod team! 🎉",
        `You now have access to the Pixl dashboard with these permissions: ${perms.filter((p) => p !== "review").join(", ")}.`,
        `Sign in with Slack here: ${DASH_URL}`,
      ].join("\n\n"),
    );
}

// Grants the Sponsor role in one go: warn, tickets (answer/resolve/fulfill),
// review, and the SECOND_PASS marker (final-pass review), tagged with the
// SPONSOR marker so the admin list can label them. Unions onto whatever perms
// they already hold rather than clobbering them , same as addReviewer layering
// on top of an existing admin. A super can still tick on any other permission
// for this person afterward from the normal per-admin form below.
export async function addSponsor(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!slackId) return;
  const existing = await getAdmin(slackId);
  const perms = [
    ...new Set([
      ...(existing?.permissions.filter((p) => p !== NO_REVIEW) ?? []),
      ...SPONSOR_BASE_PERMS,
      SECOND_PASS,
      SPONSOR,
    ]),
  ];
  await setTeamPerms(
    slackId,
    name,
    perms,
    existing ? "updated" : "added",
    actorName(access),
    actorName(access),
    "",
  );
  await dmTeam(
    slackId,
    [
      "You're a Pixl sponsor now! 🎉",
      "That's warn, ticket handling (answer/resolve/fulfill), and review access, including the final pass , your approvals credit pixels.",
      `Sign in with Slack here: ${DASH_URL}`,
    ].join("\n\n"),
  );
}

export async function updateAdminPerms(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  const existing = await getAdmin(slackId);
  if (!existing) return;
  await setTeamPerms(
    slackId,
    existing.name,
    readSubadminPerms(formData, existing.permissions),
    "updated",
    actorName(access),
  );
}

export async function removeAdmin(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!slackId || !reason) return;
  const existing = await getAdmin(slackId);
  if (!existing) return;
  await setTeamPerms(
    slackId,
    existing.name,
    existing.permissions.includes("review") ? ["review"] : [],
    "removed",
    actorName(access),
    undefined,
    reason,
  );
  await dmRemoved(slackId, "You've been removed from the Pixl mod team.", reason);
}

async function dmTeam(slackId: string, text: string): Promise<void> {
  try {
    await dmUser(slackId, text);
  } catch (e) {
    console.error("team DM failed", (e as Error).message);
  }
}

async function dmRemoved(slackId: string, headline: string, reason: string): Promise<void> {
  await dmTeam(
    slackId,
    [headline, `Reason: ${reason}`, "If you think this is a mistake, reach out to the Pixl team."].join(
      "\n\n",
    ),
  );
}

// Review rights that don't come from a "review" entry in the admins table:
// super admins hold every permission, and SECOND_PASS_SLACK_IDS grants it in
// the env. Taking review away from one of these writes a NO_REVIEW marker
// instead of dropping a permission that was never stored.
async function isImplicitReviewer(slackId: string): Promise<boolean> {
  return (await isSuperAdmin(slackId)) || secondPassSlackIds().includes(slackId);
}

// Promote a reviewer to final (second-pass) reviewer, or take it back. The
// grant lives as a SECOND_PASS marker in their admins row, alongside whatever
// SECOND_PASS_SLACK_IDS says (env grants can only be changed in the env).
export async function setSecondPass(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const enable = formData.get("enable") === "1";
  if (!slackId) return;
  const existing = await getAdmin(slackId);
  const kept = (existing?.permissions ?? []).filter((p) => p !== SECOND_PASS);
  const permissions = enable ? [...kept, SECOND_PASS] : kept;
  const already = existing?.permissions.includes(SECOND_PASS) ?? false;
  if (enable === already) return;
  await setTeamPerms(
    slackId,
    name,
    permissions,
    enable ? "promoted to final reviewer" : "final reviewer removed",
    actorName(access),
    actorName(access),
  );
  if (enable)
    await dmTeam(
      slackId,
      [
        "You've been promoted to final reviewer on Pixl! 🎉",
        `You now handle the second pass: your approvals are the ones that credit pixels. The second-review queue is waiting for you: ${DASH_URL}/review`,
      ].join("\n\n"),
    );
  else
    await dmTeam(
      slackId,
      "Your final-reviewer role on Pixl has been removed , you can still review first passes as usual. Contact the team if you think this is a mistake.",
    );
}

// Restrict a reviewer to one queue (software/hardware), or clear the
// restriction back to both. Stored the same way as SECOND_PASS: a marker in
// their admins row, mutually exclusive with its counterpart.
export async function setReviewQueueAccess(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const scope = String(formData.get("scope") ?? "both") as ReviewQueueScope;
  if (!slackId || !["software", "hardware", "both"].includes(scope)) return;
  const existing = await getAdmin(slackId);
  const kept = (existing?.permissions ?? []).filter(
    (p) => p !== REVIEW_HARDWARE_ONLY && p !== REVIEW_SOFTWARE_ONLY,
  );
  const marker = scope === "hardware" ? REVIEW_HARDWARE_ONLY : scope === "software" ? REVIEW_SOFTWARE_ONLY : null;
  const permissions = marker ? [...kept, marker] : kept;
  await setTeamPerms(
    slackId,
    name,
    permissions,
    `review queue access set to ${scope}`,
    actorName(access),
    actorName(access),
  );
  const label = scope === "both" ? "both the software and hardware queues" : `the ${scope} queue only`;
  await dmTeam(slackId, `Your Pixl review queue access was changed , you can now review ${label}.`);
}

export async function addReviewer(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!slackId) return;
  const existing = await getAdmin(slackId);
  const kept = (existing?.permissions ?? []).filter((p) => p !== NO_REVIEW);
  // Env admins review by default: lifting their block is enough, no row needed.
  const implicit = await isImplicitReviewer(slackId);
  const permissions = implicit ? kept : [...new Set([...kept, "review"])];
  const wasReviewer =
    !existing?.permissions.includes(NO_REVIEW) &&
    (existing?.permissions.includes("review") || implicit);
  await setTeamPerms(
    slackId,
    name,
    permissions,
    existing ? "updated" : "added",
    actorName(access),
    actorName(access),
  );
  if (!wasReviewer)
    await dmTeam(
      slackId,
      [
        "Welcome to the Pixl review team! 🎉",
        `You now have access to the review queue on the Pixl dashboard , projects shipped by players are waiting for your verdict: ${DASH_URL}/review`,
        "Happy reviewing!",
      ].join("\n\n"),
    );
}

export async function removeReviewer(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!slackId || !reason) return;
  const existing = await getAdmin(slackId);
  const implicit = await isImplicitReviewer(slackId);
  if (!existing && !implicit) return;
  const permissions = (existing?.permissions ?? []).filter((p) => p !== "review");
  if (implicit && !permissions.includes(NO_REVIEW)) permissions.push(NO_REVIEW);
  await setTeamPerms(
    slackId,
    existing?.name ?? "",
    permissions,
    "removed",
    actorName(access),
    actorName(access),
    reason,
  );
  await dmRemoved(slackId, "You've been removed from the Pixl review team.", reason);
  redirect("/reviewers");
}

// Helpers manage the ticket queue. Owners add/remove them here; the same
// `helpers` table is also managed from the Pixorpheus Slack bot.
export async function addHelperAction(formData: FormData): Promise<void> {
  await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  await addHelper(slackId);
  revalidatePath("/tickets");
}

export async function removeHelperAction(formData: FormData): Promise<void> {
  await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  await removeHelper(slackId);
  revalidatePath("/tickets");
}

// Fulfillers work the shop-order queue. Owners add/remove them here, same
// shape as the ticket helpers list.
export async function addFulfillerAction(formData: FormData): Promise<void> {
  await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  await addFulfiller(slackId);
  revalidatePath("/fulfillment");
}

export async function removeFulfillerAction(formData: FormData): Promise<void> {
  await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  await removeFulfiller(slackId);
  revalidatePath("/fulfillment");
}

// Moderators are an owner-managed allow-list (see lib/guard.ts) , granted
// from the Reports page since seeing reports is the core of the role.
export async function addModeratorAction(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!/^[UW][A-Z0-9]{6,}$/.test(slackId))
    redirect(`/reports?verror=${encodeURIComponent("Enter a valid Slack member ID (starts with U).")}`);
  await addModerator(slackId, name, actorName(access));
  revalidatePath("/reports");
}

export async function removeModeratorAction(formData: FormData): Promise<void> {
  await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (!slackId) return;
  await removeModerator(slackId);
  revalidatePath("/reports");
}

export async function kickPlayer(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 100);
  if (!userId) return;
  const kicked = await kickOnlinePlayer(userId, reason);
  if (kicked) await logModAction(userId, "kick", reason || "(no reason)", by);
  revalidatePath("/online");
}

// Clears every saved (user, scene) row so the player spawns at each scene's
// default next time they connect. If they're currently online we also kick
// them , otherwise their in-memory position just gets written straight back
// on disconnect (see gameServer.ts persist()), undoing the reset.
export async function resetPlayerPosition(formData: FormData): Promise<void> {
  const access = await requirePerm("ban");
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;

  const { data: cleared, error } = await db
    .from("player_state")
    .delete()
    .eq("user_id", userId)
    .select("scene");
  if (error) throw new Error(error.message);

  await kickOnlinePlayer(userId, "Your position was reset by an admin");
  await logModAction(
    userId,
    "reset_position",
    `cleared ${(cleared ?? []).length} saved position(s)`,
    by,
  );
  revalidatePath(`/players/${userId}`);
}

// Owners only , touches the identity fields the review/export pipeline and
// DMs key off of.
export async function updatePlayerInfo(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim().slice(0, 60);
  const realName = String(formData.get("realName") ?? "").trim().slice(0, 100);
  const email = String(formData.get("email") ?? "").trim().slice(0, 200);
  if (!userId || !displayName) return;

  const { error } = await db
    .from("users")
    .update({ display_name: displayName, real_name: realName, email: email || null })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  await logModAction(
    userId,
    "edit_info",
    `name: ${displayName}${realName ? ` (${realName})` : ""}${email ? `, email: ${email}` : ""}`,
    by,
  );
  revalidatePath(`/players/${userId}`);
}

// Owners only , irreversible. Every FK back to users(id) cascades (see
// drizzle/0019_user_delete_cascade.sql), including mod_actions, so there's no
// row left to log this against afterwards , console.log is the only record
// that survives.
export async function deletePlayerAccount(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const by = actorName(access);
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  if (!userId || !reason) return;

  const { data: player } = await db
    .from("users")
    .select("display_name, real_name")
    .eq("id", userId)
    .maybeSingle();
  const playerName = playerLabel(player, userId);

  await dmOrEmail(
    userId,
    "Pixl account deleted",
    [
      "Your Pixl account has been deleted by an admin.",
      `Reason: ${reason}`,
      "If you believe this is a mistake, reach out to the Pixl team.",
    ].join("\n\n"),
  );
  await kickOnlinePlayer(userId, "Your account was deleted");

  const { error } = await db.from("users").delete().eq("id", userId);
  if (error) throw new Error(error.message);

  console.log(`[admin] ${by} deleted account ${playerName} (${userId}): ${reason}`);
  revalidatePath("/players");
  redirect(`/players?done=${encodeURIComponent(`Deleted ${playerName}'s account.`)}`);
}

// Upload a shop image to Supabase Storage (public "shop" bucket, created on
// first use) and return its public URL. Resized/re-encoded to WebP first,
// shop images are shown at most at 300×300 (the item detail page), but
// admins often upload straight-from-phone photos that can be several MB,
// which made shop pages painfully slow to load. Capping at 900×900 (a 3x
// retina margin) and re-encoding to WebP keeps every upload small regardless
// of what was submitted.
async function uploadShopImageBuffer(raw: Buffer): Promise<string> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error("Supabase is not configured");
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  const { default: sharp } = await import("sharp");
  const body = await sharp(raw)
    .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const upload = () =>
    fetch(`${base}/storage/v1/object/shop/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "image/webp",
      },
      body,
    });
  let res = await upload();
  if (res.status === 400 || res.status === 404) {
    await fetch(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: "shop", name: "shop", public: true }),
    });
    res = await upload();
  }
  if (!res.ok) throw new Error(`image upload failed (${res.status})`);
  return `${base}/storage/v1/object/public/shop/${name}`;
}

async function uploadShopImage(file: File): Promise<string> {
  return uploadShopImageBuffer(Buffer.from(await file.arrayBuffer()));
}

async function uploadShopImageFromUrl(url: string): Promise<string> {
  await assertSafeExternalUrl(url);
  // redirect: "manual" so a validated hostname can't hand back a 3xx to an
  // internal address (e.g. the cluster metadata IP) and have fetch silently
  // follow it past the check above.
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new Error("image URL redirected, refusing to follow");
  }
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
  return uploadShopImageBuffer(Buffer.from(await res.arrayBuffer()));
}

function readRegion(raw: string): ShopRegion {
  return (SHOP_REGIONS as readonly string[]).includes(raw) ? (raw as ShopRegion) : "US";
}

function readCategory(raw: string): ShopCategory {
  return (SHOP_CATEGORIES as readonly string[]).includes(raw) ? (raw as ShopCategory) : "other";
}

function readOptions(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  // The options editor submits JSON groups: [{ name, choices: [] }].
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return serializeGroups(
          parsed.map((g) => ({
            name: String(g?.name ?? ""),
            choices: Array.isArray(g?.choices) ? g.choices.map(String) : [],
          })),
        );
      }
    } catch {
      /* fall through to the comma-list fallback */
    }
  }
  // Fallback: a plain comma list becomes a single unnamed group.
  return serializeGroups([{ name: "", choices: s.split(",") }]);
}

// Adds one item, optionally to several regions at once. `regions` is a
// comma-separated list from the form (falls back to the single `region`
// field so old bookmarked/scripted submits with just that field still work);
// each region can override the shared `price` via a `price_<REGION>` field,
// e.g. `price_INDIA`, a region with no such field just uses `price`.
export async function addShopItem(formData: FormData): Promise<void> {
  const access = await requirePerm("shop");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const basePrice = Math.max(0, Math.round(Number(formData.get("price") ?? 0)));
  const options = readOptions(String(formData.get("options") ?? ""));
  const category = readCategory(String(formData.get("category") ?? ""));
  const regionsRaw = String(formData.get("regions") ?? formData.get("region") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const regions = [...new Set(regionsRaw.map(readRegion))];
  if (!name || regions.length === 0) return;

  let imageUrl = "";
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    if (image.size > 4 * 1024 * 1024) throw new Error("Image too big (max 4 MB).");
    imageUrl = await uploadShopImage(image);
  }

  const cutoff = new Date(Date.now() - 60_000).toISOString();
  for (const region of regions) {
    const regionPriceRaw = formData.get(`price_${region}`);
    const price =
      regionPriceRaw != null ? Math.max(0, Math.round(Number(regionPriceRaw))) : basePrice;

    // Double-submit guard: an identical name+region created in the last
    // minute is the same click arriving twice, not a new item.
    const { data: recent } = await db
      .from("shop_items")
      .select("id")
      .eq("name", name)
      .eq("region", region)
      .gte("created_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) continue;

    const { data: inserted, error } = await db
      .from("shop_items")
      .insert({
        name,
        description,
        price,
        image_url: imageUrl,
        options,
        region,
        category,
        created_by: actorName(access),
      })
      .select("*")
      .single();
    if (error) throw new Error(`${region}: ${error.message}`);
    if (inserted) await notifyShopInsert(inserted as ShopRowSnapshot);
  }
  revalidatePath("/shop");
}

export async function updateShopItem(formData: FormData): Promise<void> {
  await requirePerm("shop");
  const id = Number(formData.get("id") ?? 0);
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const description = String(formData.get("description") ?? "").trim().slice(0, 300);
  const price = Math.max(0, Math.round(Number(formData.get("price") ?? 0)));
  const options = readOptions(String(formData.get("options") ?? ""));
  const region = readRegion(String(formData.get("region") ?? ""));
  const category = readCategory(String(formData.get("category") ?? ""));
  if (!id || !name) return;
  // Trial gate: which Trials unlock this item (empty = buyable). Item-wide, so
  // it's propagated to every region row of the item below, not kept per-region.
  const unlockTrials = formData
    .getAll("unlock_trials")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  // A second, manual way to lock an item that isn't tied to any Trial,
  // also item-wide, mirrored below the same way the Trial gate is.
  const manualLocked = formData.get("manual_locked") === "1";
  const lockNote = String(formData.get("lock_note") ?? "").trim().slice(0, 300);
  // Saving silently skips telling pixorpheus about this change (e.g. a typo
  // fix that isn't worth a Slack ping), see notifyShopUpdates below.
  const silent = formData.get("silent") === "1";
  const patch: Record<string, unknown> = {
    name,
    description,
    price,
    options,
    region,
    category,
    unlock_trial_ids: unlockTrials,
    manual_locked: manualLocked,
    lock_note: lockNote,
  };
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) {
    if (image.size > 4 * 1024 * 1024) throw new Error("Image too big (max 4 MB).");
    patch.image_url = await uploadShopImage(image);
  }
  // "Apply name & description to every region": the same item lives as one row
  // per region (matched by name), so propagate just those two shared fields to
  // its siblings. Match on the ORIGINAL name (the edit may rename it), and skip
  // trophies (unlock_xp > 0) since those aren't region-scoped.
  const applyAllRegions = String(formData.get("apply_all_regions") ?? "") === "1";
  const originalName = String(formData.get("original_name") ?? "").trim();

  // Snapshot every row this call may touch BEFORE writing, so pixorpheus can be
  // handed an old → new diff. The sibling ids have to be resolved up front too:
  // once the main row is renamed they no longer all share `originalName`.
  const affectedIds = [id];
  if (applyAllRegions && originalName) {
    const { data: siblings } = await db
      .from("shop_items")
      .select("id")
      .eq("name", originalName)
      .eq("unlock_xp", 0)
      .neq("id", id);
    for (const s of siblings ?? []) affectedIds.push(s.id as number);
  }
  const { data: before } = await db.from("shop_items").select("*").in("id", affectedIds);

  const { error } = await db.from("shop_items").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  // A Trial gate is item-wide, so mirror it onto every region row of this item
  // (matched by its name before any rename), never locked in one region and
  // open in another. The edited row itself already got it via `patch`.
  const gateName = originalName || name;
  const { error: gateErr } = await db
    .from("shop_items")
    .update({ unlock_trial_ids: unlockTrials })
    .eq("name", gateName)
    .eq("unlock_xp", 0);
  if (gateErr) console.error("updateShopItem (trial gate)", gateErr.message);

  // Same for the manual lock , item-wide, not per-region.
  const { error: lockErr } = await db
    .from("shop_items")
    .update({ manual_locked: manualLocked, lock_note: lockNote })
    .eq("name", gateName)
    .eq("unlock_xp", 0);
  if (lockErr) console.error("updateShopItem (manual lock)", lockErr.message);

  if (applyAllRegions && originalName) {
    const { error: propErr } = await db
      .from("shop_items")
      .update({ name, description, category })
      .eq("name", originalName)
      .eq("unlock_xp", 0)
      .neq("id", id);
    if (propErr) throw new Error(propErr.message);
  }

  if (!silent) {
    const { data: after } = await db.from("shop_items").select("*").in("id", affectedIds);
    await notifyShopUpdates(
      (before ?? []) as ShopRowSnapshot[],
      (after ?? []) as ShopRowSnapshot[],
    );
  }

  revalidatePath("/shop");
}

// Reprices an item across every region in one save, so an admin doesn't have
// to switch the region tab and reopen "Edit item" per region. Matched by name
// (the same item is one row per region), same as apply_all_regions above.
// A region with no price field submitted (shouldn't happen, the form always
// renders all of SHOP_REGIONS) is left untouched; a region with no existing
// row for this item is a no-op update, not an insert , stocking a brand new
// region still goes through "Add an item" on that region's tab.
export async function updateShopItemPrices(formData: FormData): Promise<void> {
  await requirePerm("shop");
  const name = String(formData.get("item_name") ?? "").trim();
  if (!name) return;

  const { data: before } = await db
    .from("shop_items")
    .select("*")
    .eq("name", name)
    .eq("unlock_xp", 0);

  for (const r of SHOP_REGIONS) {
    const raw = formData.get(`price_${r}`);
    if (raw === null) continue;
    const price = Math.max(0, Math.round(Number(raw) || 0));
    const { error } = await db
      .from("shop_items")
      .update({ price })
      .eq("name", name)
      .eq("region", r)
      .eq("unlock_xp", 0);
    if (error) console.error("updateShopItemPrices", r, error.message);
  }

  const { data: after } = await db
    .from("shop_items")
    .select("*")
    .eq("name", name)
    .eq("unlock_xp", 0);
  await notifyShopUpdates(
    (before ?? []) as ShopRowSnapshot[],
    (after ?? []) as ShopRowSnapshot[],
  );

  revalidatePath("/shop");
}

// Hide/show an item. Regular items have one row per region (same name), and
// the dashboard only shows one region tab at a time - toggling just the row
// you're looking at left every other region's copy untouched, so "hiding" an
// item never actually hid it anywhere else. Match updateShopItemPrices's
// by-name-across-regions pattern instead. Trophies (unlock_xp > 0) aren't
// region-scoped and only ever have one row, so they keep the simple
// single-row toggle.
export async function toggleShopItem(formData: FormData): Promise<void> {
  await requirePerm("shop");
  const id = Number(formData.get("id") ?? 0);
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  const { data: target } = await db
    .from("shop_items")
    .select("name, unlock_xp")
    .eq("id", id)
    .maybeSingle();
  if (!target) return;

  const isTrophy = Number(target.unlock_xp) > 0;
  const { data: before } = await db
    .from("shop_items")
    .select("*")
    .eq(isTrophy ? "id" : "name", isTrophy ? id : target.name)
    .eq("unlock_xp", isTrophy ? target.unlock_xp : 0);

  const { data: after, error } = await db
    .from("shop_items")
    .update({ active })
    .eq(isTrophy ? "id" : "name", isTrophy ? id : target.name)
    .eq("unlock_xp", isTrophy ? target.unlock_xp : 0)
    .select("*");
  if (error) throw new Error(error.message);
  if (before && after) {
    await notifyShopUpdates(before as ShopRowSnapshot[], after as ShopRowSnapshot[]);
  }
  revalidatePath("/shop");
}

export async function deleteShopItem(formData: FormData): Promise<void> {
  await requirePerm("shop");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { data: removed } = await db.from("shop_items").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("shop_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if (removed) await notifyShopDelete(removed as ShopRowSnapshot);
  revalidatePath("/shop");
}

export interface ShopCsvRow {
  key: string; // stable per-row id assigned client-side, echoed back so results line up
  name: string;
  price: number;
  region: ShopRegion;
  description: string;
  options: string;
  imageUrl: string;
  unlockXp: number;
}

// Bulk-upload preview step: tell the client which rows already have a
// same-name-and-region item in the shop, so it can ask the admin to
// replace or skip each one before anything is written.
export async function checkShopItemsConflicts(
  rows: ShopCsvRow[],
): Promise<Record<string, { id: number; price: number; description: string }>> {
  await requirePerm("shop");
  const names = [...new Set(rows.map((r) => r.name).filter(Boolean))];
  if (names.length === 0) return {};
  const { data, error } = await db
    .from("shop_items")
    .select("id, name, region, price, description")
    .in("name", names);
  if (error) throw new Error(error.message);
  const byKey: Record<string, { id: number; price: number; description: string }> = {};
  for (const row of data ?? []) {
    byKey[`${row.name}|${row.region}`] = {
      id: row.id,
      price: row.price,
      description: row.description,
    };
  }
  const out: Record<string, { id: number; price: number; description: string }> = {};
  for (const r of rows) {
    const hit = byKey[`${r.name}|${r.region}`];
    if (hit) out[r.key] = hit;
  }
  return out;
}

// Bulk-upload commit step. `resolutions[row.key]` is "replace" or "skip" for
// rows that checkShopItemsConflicts flagged as already existing; rows with no
// conflict are always inserted.
export async function commitShopItemsCsv(
  rows: ShopCsvRow[],
  conflicts: Record<string, number>, // key -> existing shop_items.id
  resolutions: Record<string, "replace" | "skip">,
): Promise<{ added: number; replaced: number; skipped: number; errors: string[] }> {
  const access = await requirePerm("shop");
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const name = row.name.trim().slice(0, 60);
    if (!name) continue;
    const existingId = conflicts[row.key];
    if (existingId && resolutions[row.key] !== "replace") {
      skipped++;
      continue;
    }
    let imageUrl = "";
    if (row.imageUrl.trim()) {
      try {
        imageUrl = await uploadShopImageFromUrl(row.imageUrl.trim());
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : "image fetch failed"}`);
      }
    }
    const patch: Record<string, unknown> = {
      name,
      description: row.description.trim().slice(0, 300),
      price: Math.max(0, Math.round(row.price || 0)),
      options: readOptions(row.options),
      region: readRegion(row.region),
      unlock_xp: Math.max(0, Math.round(row.unlockXp || 0)),
    };
    if (imageUrl) patch.image_url = imageUrl;
    if (existingId) {
      const { error } = await db.from("shop_items").update(patch).eq("id", existingId);
      if (error) errors.push(`${name}: ${error.message}`);
      else replaced++;
    } else {
      const { error } = await db
        .from("shop_items")
        .insert({ ...patch, image_url: imageUrl, created_by: actorName(access) });
      if (error) errors.push(`${name}: ${error.message}`);
      else added++;
    }
  }
  revalidatePath("/shop");
  return { added, replaced, skipped, errors };
}

// Claim an unclaimed (pending) order: the fulfiller has placed the real order
// and now owns it. It moves into their queue at the 'ordered' stage (placed, not
// yet credited by HCB) and nobody else advances it unless they reassign it.
export async function claimOrder(formData: FormData): Promise<void> {
  const access = await requireFulfiller();
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { data: order } = await db
    .from("shop_orders")
    .select("user_id, item_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.status !== "pending") {
    revalidatePath("/fulfillment");
    return;
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from("shop_orders")
    .update({
      status: "ordered",
      claimed_by: actorName(access),
      claimed_by_slack: access.session.slackId,
      claimed_at: now,
      ordered_at: now,
    })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  const placedBody = `Your "${order.item_name}" order has been placed and is being fulfilled. We'll let you know when it ships.`;
  await db.from("notifications").insert({
    user_id: order.user_id,
    title: "Order placed! 📦",
    body: placedBody,
  });
  await dmOrEmail(order.user_id, "Order placed! 📦", placedBody);
  revalidatePath("/fulfillment");
}

// Over budget: the cheapest the fulfiller could find it for is more than the
// player's pixels are worth. Nothing gets ordered , the flag parks it for an
// owner to decide (source it anyway, talk to the player, or cancel & refund).
export async function flagOrderOverBudget(formData: FormData): Promise<void> {
  const access = await requireFulfiller();
  const id = Number(formData.get("id") ?? 0);
  const note = String(formData.get("flagNote") ?? "").trim().slice(0, 300);
  if (!id || !note) return;
  const { error } = await db
    .from("shop_orders")
    .update({
      flagged_at: new Date().toISOString(),
      flagged_by: actorName(access),
      flag_note: note,
    })
    .eq("id", id)
    .in("status", ["pending", "ordered", "credited"]);
  if (error) throw new Error(error.message);
  revalidatePath("/fulfillment");
}

// Owner has dealt with it, put the order back in the normal flow.
export async function clearOrderFlag(formData: FormData): Promise<void> {
  await requirePerm("fulfillment");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("shop_orders")
    .update({ flagged_at: null, flagged_by: "", flag_note: "" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/fulfillment");
}

// Owner of an order re-checks the caller is the fulfiller who claimed it (or lets
// a super take it over via reassignOrder). Advancing a claimed order past the
// stage where someone else owns it would step on their queue.
function ownsOrder(access: AdminAccess, claimedSlack: string): boolean {
  return claimedSlack === access.session.slackId;
}

// HCB credited the card and the fulfiller uploaded the receipt: ordered ->
// credited (paid, not shipped yet). Only the claiming fulfiller can advance it.
export async function markOrderCredited(formData: FormData): Promise<void> {
  const access = await requireFulfiller();
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { data: order } = await db
    .from("shop_orders")
    .select("status, claimed_by_slack")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.status !== "ordered" || !ownsOrder(access, order.claimed_by_slack)) {
    revalidatePath("/fulfillment");
    return;
  }
  const { error } = await db
    .from("shop_orders")
    .update({ status: "credited", credited_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "ordered");
  if (error) throw new Error(error.message);
  revalidatePath("/fulfillment");
}

// The order shipped: credited -> shipped with a tracking number. The number is
// DM'd to the buyer by Pixo and also lands as an in-game notification. Only the
// claiming fulfiller can ship it, and tracking is required.
export async function shipOrder(formData: FormData): Promise<void> {
  const access = await requireFulfiller();
  const id = Number(formData.get("id") ?? 0);
  const tracking = String(formData.get("tracking") ?? "").trim().slice(0, 120);
  if (!id) return;
  if (!tracking) {
    revalidatePath("/fulfillment");
    return;
  }
  const { data: order } = await db
    .from("shop_orders")
    .select("user_id, item_name, status, claimed_by_slack")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.status !== "credited" || !ownsOrder(access, order.claimed_by_slack)) {
    revalidatePath("/fulfillment");
    return;
  }
  const { error } = await db
    .from("shop_orders")
    .update({
      status: "shipped",
      shipped_at: new Date().toISOString(),
      fulfilled_at: new Date().toISOString(),
      fulfilled_by: actorName(access),
      tracking,
    })
    .eq("id", id)
    .eq("status", "credited");
  if (error) throw new Error(error.message);

  await db.from("notifications").insert({
    user_id: order.user_id,
    title: "Order shipped! 📦",
    body: `Your "${order.item_name}" order shipped. Tracking: ${tracking}`,
  });
  // DM the tracking number to the buyer through Pixo. Best-effort , a missing
  // Slack link shouldn't block shipping, and the in-game notification still lands.
  const { data: buyer } = await db
    .from("users")
    .select("slack_id")
    .eq("id", order.user_id)
    .maybeSingle();
  if (buyer?.slack_id) {
    try {
      await dmUser(
        buyer.slack_id,
        `📦 Your "${order.item_name}" order shipped! Tracking number: ${tracking}`,
      );
    } catch (err) {
      console.error("shipOrder DM", err instanceof Error ? err.message : err);
    }
  }
  revalidatePath("/fulfillment");
}

// Close a shipped order out: shipped -> done, once the buyer has it in hand.
// Any super can mark it done (it's the final administrative close, not a queue
// advance), and it's a no-op on anything that isn't shipped.
export async function markOrderDone(formData: FormData): Promise<void> {
  await requirePerm("fulfillment");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("shop_orders")
    .update({ status: "done", done_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "shipped");
  if (error) throw new Error(error.message);
  revalidatePath("/fulfillment");
}

// Take over a claimed order that isn't yet shipped/cancelled. Escape hatch for
// when the original fulfiller can't finish it , the caller becomes the new owner
// and the order stays at its current stage.
export async function reassignOrder(formData: FormData): Promise<void> {
  const access = await requirePerm("fulfillment");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("shop_orders")
    .update({ claimed_by: actorName(access), claimed_by_slack: access.session.slackId })
    .eq("id", id)
    .in("status", ["ordered", "credited"]);
  if (error) throw new Error(error.message);
  revalidatePath("/fulfillment");
}

// Cancel a live order (pending / ordered / credited) and refund the pixels , e.g.
// a blocked Amazon account killed it. The refund + status flip happen inside
// cancel_shop_order so they can't drift apart; it's idempotent, so a double-click
// won't refund twice and a shipped order is a no-op.
export async function cancelOrder(formData: FormData): Promise<void> {
  const access = await requirePerm("fulfillment");
  const id = Number(formData.get("id") ?? 0);
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (!id) return;
  const { data: order } = await db
    .from("shop_orders")
    .select("user_id, item_name, status")
    .eq("id", id)
    .maybeSingle();
  if (
    !order ||
    order.status === "shipped" ||
    order.status === "done" ||
    order.status === "cancelled"
  ) {
    revalidatePath("/fulfillment");
    return;
  }
  const { data: refunded, error } = await db.rpc("cancel_shop_order", {
    p_order_id: id,
    p_by: actorName(access),
  });
  if (error) throw new Error(error.message);
  if (note) await db.from("shop_orders").update({ note }).eq("id", id);
  const amount = Number(refunded ?? 0);
  const cancelBody = `Your "${order.item_name}" order was cancelled and ${amount} pixel${amount === 1 ? "" : "s"} refunded.${note ? ` ${note}` : ""}`;
  await db.from("notifications").insert({
    user_id: order.user_id,
    title: "Order cancelled",
    body: cancelBody,
  });
  await dmOrEmail(order.user_id, "Order cancelled", cancelBody);
  revalidatePath("/fulfillment");
  revalidatePath("/pixels");
}

// Backfill player-card photos from Slack for everyone who has a slack_id but
// no photo yet. New sign-ups get theirs automatically from the game server.
export async function syncSlackAvatars(): Promise<void> {
  await requireSuper();
  const avatars = await slackAvatars();
  if (avatars.size === 0)
    redirect(`/players?error=${encodeURIComponent("Slack returned no profile photos , check SLACK_BOT_TOKEN.")}`);
  const { data: users, error } = await db
    .from("users")
    .select("id, slack_id, avatar_url")
    .not("slack_id", "is", null);
  if (error) {
    console.error("syncSlackAvatars", error.message);
    redirect(`/players?error=${encodeURIComponent("Couldn't load players.")}`);
  }
  let updated = 0;
  for (const u of users ?? []) {
    if (u.avatar_url) continue;
    const img = avatars.get(u.slack_id as string);
    if (!img) continue;
    const { error: upErr } = await db.from("users").update({ avatar_url: img }).eq("id", u.id);
    if (!upErr) updated++;
  }
  revalidatePath("/", "layout");
  redirect(
    `/players?done=${encodeURIComponent(`Filled ${updated} player card photo${updated === 1 ? "" : "s"} from Slack.`)}`,
  );
}

export async function addSidequest(formData: FormData): Promise<void> {
  const access = await requirePerm("sidequests");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const region = String(formData.get("region") ?? "").trim().slice(0, 40);
  const npc = String(formData.get("npc") ?? "").trim().slice(0, 40);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  const brief = String(formData.get("brief") ?? "").trim().slice(0, 3000);
  const reward = String(formData.get("reward") ?? "").trim().slice(0, 120);
  const minHoursRaw = String(formData.get("minHours") ?? "").trim();
  const minHours = minHoursRaw === "" ? null : Math.max(0, Number(minHoursRaw));
  if (!name)
    redirect(`/sidequests?error=${encodeURIComponent("A sidequest needs a name.")}`);
  if (minHoursRaw !== "" && !Number.isFinite(minHours))
    redirect(`/sidequests?error=${encodeURIComponent("Minimum hours must be a number.")}`);
  const { error } = await db.from("sidequests").insert({
    name,
    region,
    npc,
    description,
    brief,
    reward,
    min_hours: minHours,
    created_by: actorName(access),
  });
  if (error) {
    console.error("addSidequest", error.message);
    redirect(`/sidequests?error=${encodeURIComponent("Couldn't save , is the sidequests migration applied?")}`);
  }
  revalidatePath("/sidequests");
  redirect("/sidequests?created=1");
}

export async function toggleSidequest(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("sidequests")
    .update({ active: formData.get("active") === "1" })
    .eq("id", id);
  if (error) console.error("toggleSidequest", error.message);
  revalidatePath("/sidequests");
}

export async function updateSidequest(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const region = String(formData.get("region") ?? "").trim().slice(0, 40);
  const npc = String(formData.get("npc") ?? "").trim().slice(0, 40);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);
  const brief = String(formData.get("brief") ?? "").trim().slice(0, 3000);
  const reward = String(formData.get("reward") ?? "").trim().slice(0, 120);
  const minHoursRaw = String(formData.get("minHours") ?? "").trim();
  const minHours = minHoursRaw === "" ? null : Math.max(0, Number(minHoursRaw));
  if (!name)
    redirect(`/sidequests?error=${encodeURIComponent("A sidequest needs a name.")}`);
  if (minHoursRaw !== "" && !Number.isFinite(minHours))
    redirect(`/sidequests?error=${encodeURIComponent("Minimum hours must be a number.")}`);
  const { error } = await db
    .from("sidequests")
    .update({ name, region, npc, description, brief, reward, min_hours: minHours })
    .eq("id", id);
  if (error) {
    console.error("updateSidequest", error.message);
    redirect(`/sidequests?error=${encodeURIComponent("Couldn't save the changes.")}`);
  }
  revalidatePath("/sidequests");
  redirect("/sidequests?saved=1");
}

export async function deleteSidequest(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("sidequests").delete().eq("id", id);
  if (error) {
    console.error("deleteSidequest", error.message);
    const msg =
      error.code === "23503"
        ? "Can't delete , a shipped project is still linked to this sidequest."
        : "Couldn't delete the sidequest.";
    redirect(`/sidequests?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/sidequests");
}

// ── NPCs ────────────────────────────────────────────────────────────────────
// An NPC used to be a hand-placed node in the game's village.tscn/open_world.tscn,
// so adding one meant opening the Godot editor and shipping a build. These write
// the `npcs` table the client reads at world load instead.

const NPC_WORLDS = new Set(["village", "open_world"]);

// Mirrors what the game can resolve for an NPC: a cvc: preset, a cv1: composite,
// or an npc:<name> NPC-only sheet (SkinUtil.NPC_SHEETS - pixo, cheetah). The
// npc: skins are intentionally NPC-only: SkinUtil.is_valid() still rejects them
// so a player can never wear one, but NPCs placed from here may. Keep the npc:
// list in sync with SkinUtil.NPC_SHEETS in apps/game/scripts/skin_util.gd.
// Rejecting here keeps a typo from spawning an NPC with no sprite at all.
const SKIN_RE = /^(cvc:[1-9]|cv1:b[1-3]h(\d|1[0-8])t([1-9]|1[0-8])o([1-9]|1[0-8])|npc:(pixo|cheetah))$/;

// npc.gd dispatches its modes as an if/elif chain, so they're mutually exclusive
// at runtime. The form models that as one "kind" select rather than six
// independent checkboxes that could contradict each other.
const NPC_KINDS = {
  dialogue: {},
  projects: { opens_projects: true },
  explore: { opens_explore: true },
  trial: { quest_trial: true },
  project_quest: { quest_project: true },
  faq: { faq: true },
} as const;

type NpcKind = keyof typeof NPC_KINDS;

function npcFields(formData: FormData, fail: (msg: string) => never) {
  const world = String(formData.get("world") ?? "").trim();
  if (!NPC_WORLDS.has(world)) fail("Pick a world.");

  const npcName = String(formData.get("npcName") ?? "").trim().slice(0, 40);
  if (!npcName) fail("An NPC needs a name.");

  const skin = String(formData.get("skin") ?? "").trim();
  if (!SKIN_RE.test(skin)) fail(`"${skin}" isn't a skin the game can resolve.`);

  const posX = Number(String(formData.get("posX") ?? "").trim());
  const posY = Number(String(formData.get("posY") ?? "").trim());
  if (!Number.isFinite(posX) || !Number.isFinite(posY))
    fail("Pick a spot on the map.");

  const kind = String(formData.get("kind") ?? "dialogue") as NpcKind;
  if (!(kind in NPC_KINDS)) fail("Pick what this NPC does.");

  const trialIdRaw = String(formData.get("sidequestId") ?? "").trim();
  const sidequestId = trialIdRaw === "" ? null : Number(trialIdRaw);
  if (trialIdRaw !== "" && !Number.isFinite(sidequestId)) fail("Pick a valid Trial.");
  if (kind === "trial" && sidequestId === null)
    fail("A Trial-giver needs a Trial to hand out.");

  const checkin = formData.get("trialCheckin") === "1";

  return {
    world,
    npc_name: npcName,
    pos_x: posX,
    pos_y: posY,
    skin,
    dialogue: String(formData.get("dialogue") ?? "").trim().slice(0, 1000),
    opens_projects: false,
    opens_explore: false,
    quest_project: false,
    faq: false,
    quest_trial: false,
    ...NPC_KINDS[kind],
    // Only meaningful on a Trial-giver; a check-in copy stays hidden until its
    // Trial is active, so setting it on any other kind hides the NPC forever.
    trial_checkin: kind === "trial" && checkin,
    sidequest_id: kind === "trial" ? sidequestId : null,
    quest_offer: String(formData.get("questOffer") ?? "").trim().slice(0, 1500),
    quest_done: String(formData.get("questDone") ?? "").trim().slice(0, 1000),
    trial_reminder: String(formData.get("trialReminder") ?? "").trim().slice(0, 1000),
    wanders: formData.get("wanders") === "1",
  };
}

function npcError(error: { message: string; code?: string }): string {
  if (error.code === "23505")
    return "An NPC with that name already exists in that world , the game keys saved positions on the name, so they have to be unique.";
  if (error.code === "42P01")
    return "Couldn't save , is the npcs migration applied?";
  return "Couldn't save the NPC.";
}

export async function addNpc(formData: FormData): Promise<void> {
  const access = await requirePerm("sidequests");
  const fail = (msg: string): never =>
    redirect(`/sidequests?tab=npcs&error=${encodeURIComponent(msg)}`);
  const fields = npcFields(formData, fail);
  const { error } = await db
    .from("npcs")
    .insert({ ...fields, created_by: actorName(access) });
  if (error) {
    console.error("addNpc", error.message);
    fail(npcError(error));
  }
  revalidatePath("/sidequests");
  redirect("/sidequests?tab=npcs&created=npc");
}

export async function updateNpc(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const fail = (msg: string): never =>
    redirect(`/sidequests?tab=npcs&error=${encodeURIComponent(msg)}`);
  const fields = npcFields(formData, fail);
  const { error } = await db.from("npcs").update(fields).eq("id", id);
  if (error) {
    console.error("updateNpc", error.message);
    fail(npcError(error));
  }
  revalidatePath("/sidequests");
  redirect("/sidequests?tab=npcs&saved=npc");
}

export async function toggleNpc(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("npcs")
    .update({ active: formData.get("active") === "1" })
    .eq("id", id);
  if (error) console.error("toggleNpc", error.message);
  revalidatePath("/sidequests");
}

export async function deleteNpc(formData: FormData): Promise<void> {
  await requirePerm("sidequests");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("npcs").delete().eq("id", id);
  if (error) {
    console.error("deleteNpc", error.message);
    redirect(`/sidequests?tab=npcs&error=${encodeURIComponent("Couldn't delete the NPC.")}`);
  }
  revalidatePath("/sidequests");
}

export async function createEvent(formData: FormData): Promise<void> {
  const access = await requirePerm("events");
  const type = String(formData.get("type") ?? "");
  const fail = (msg: string) => redirect(`/events?error=${encodeURIComponent(msg)}`);
  if (!(type in EVENT_TYPES)) fail("Pick an event type.");
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  if (!name) fail("Give the event a name players will see.");
  const startsRaw = String(formData.get("startsAt") ?? "").trim();
  const endsRaw = String(formData.get("endsAt") ?? "").trim();
  const starts = startsRaw ? new Date(startsRaw + "Z") : new Date();
  const ends = new Date(endsRaw + "Z");
  if (!endsRaw || isNaN(ends.getTime())) fail("An end time is required.");
  if (isNaN(starts.getTime()) || ends <= starts) fail("The event must end after it starts.");

  const config: Record<string, unknown> = {};
  if (type === "bounty") {
    const reward = Math.round(Number(formData.get("reward") ?? 0));
    if (reward <= 0) fail("A bounty needs a pixel reward.");
    config.reward = Math.min(reward, 500);
    config.description = String(formData.get("description") ?? "").trim().slice(0, 500);
  } else if (type === "community_goal") {
    const target = Math.round(Number(formData.get("target") ?? 0));
    const bonusPct = Math.round(Number(formData.get("bonusPct") ?? 0));
    if (target <= 0 || bonusPct <= 0) fail("A community goal needs a ship target and a bonus %.");
    config.target = target;
    config.bonusPct = Math.min(bonusPct, 50);
    const projectType = String(formData.get("projectType") ?? "").trim();
    if (projectType) config.projectType = projectType;
  } else if (type === "review_blitz") {
    const mult = Number(formData.get("mult") ?? 1.5);
    if (!(mult > 1)) fail("The blitz multiplier must be above 1.");
    config.mult = Math.min(mult, 3);
  } else if (type === "mystery_merchant") {
    const itemIds = [...new Set(formData.getAll("itemIds").map(Number))].filter(
      (n) => Number.isFinite(n) && n > 0,
    );
    if (itemIds.length === 0) fail("Pick at least one shop item for the merchant.");
    config.itemIds = itemIds;
  }

  const { error } = await db.from("events").insert({
    type,
    name,
    config,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    created_by: actorName(access),
  });
  if (error) {
    console.error("createEvent", error.message);
    fail("Couldn't create the event , is the events migration applied?");
  }
  revalidatePath("/", "layout");
  redirect("/events?created=1");
}

export async function stopEvent(formData: FormData): Promise<void> {
  await requirePerm("events");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("events")
    .update({ stopped_at: new Date().toISOString() })
    .eq("id", id)
    .is("stopped_at", null);
  if (error) console.error("stopEvent", error.message);
  revalidatePath("/", "layout");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  await requirePerm("events");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("events").delete().eq("id", id);
  if (error) console.error("deleteEvent", error.message);
  revalidatePath("/", "layout");
}

export async function undoTeamChange(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { data } = await db.from("team_log").select("*").eq("id", id).single();
  if (!data) return;
  // Super-admin grants are logged here but don't live in `admins` , undoing
  // one through setTeamPerms would write a bogus permission row. Promote or
  // demote from the Super admins card instead.
  if (String(data.action).startsWith("super ")) return;
  await setTeamPerms(
    String(data.slack_id),
    String(data.name),
    (data.before ?? []) as string[],
    "undo",
    actorName(access),
    actorName(access),
  );
}

export async function resolveReport(formData: FormData): Promise<void> {
  const session = await requireReportViewer();
  const id = Number(formData.get("id") ?? 0);
  const dismissed = formData.get("action") === "dismiss";
  if (!id) return;
  const { data: updated, error } = await db
    .from("reports")
    .update({
      status: dismissed ? "dismissed" : "resolved",
      handled_by: `${session.name} (${session.slackId})`,
      handled_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("reporter_id, target_id")
    .single();
  if (error) {
    console.error("resolveReport", error.message);
    return;
  }
  // Close the loop with the reporter , works even for anonymous reports, since
  // it goes to them privately and never names them to anyone.
  if (updated?.reporter_id) {
    const { data: target } = await db
      .from("users")
      .select("display_name, real_name")
      .eq("id", updated.target_id)
      .single();
    const name = target?.real_name || target?.display_name || "a player";
    const title = "Report reviewed";
    const body = dismissed
      ? `Your report on ${name} was reviewed and closed , no action was needed this time. Thanks for helping keep Pixl safe.`
      : `Your report on ${name} was reviewed and acted on. Thanks for helping keep Pixl safe.`;
    await db.from("notifications").insert({ user_id: updated.reporter_id, title, body });
    await dmOrEmail(updated.reporter_id, title, body);
  }
  revalidatePath("/reports");
}

// Grant/revoke is a super-admin-only action, distinct from being able to
// view reports, otherwise any report viewer (a widely-granted role that
// also includes moderators) could add or remove other viewers and widen
// access to reports full of chat logs, addresses, and other PII.
export async function addReportViewerAction(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim().toUpperCase();
  if (!/^[UW][A-Z0-9]{6,}$/.test(slackId))
    redirect(`/reports?verror=${encodeURIComponent("Enter a valid Slack member ID (starts with U).")}`);
  await addReportViewer(slackId, actorName(access));
  revalidatePath("/reports");
}

export async function removeReportViewerAction(formData: FormData): Promise<void> {
  const access = await requireSuper();
  const slackId = String(formData.get("slackId") ?? "").trim();
  if (slackId && slackId !== access.session.slackId) await removeReportViewer(slackId);
  revalidatePath("/reports");
}

function parseRewards(raw: string): { icon: string; label: string }[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => {
      const sp = l.indexOf(" ");
      if (sp === -1) return { icon: "🎁", label: l.slice(0, 60) };
      return { icon: l.slice(0, sp), label: l.slice(sp + 1).trim().slice(0, 60) };
    });
}

export async function addVaultLevel(formData: FormData): Promise<void> {
  await requirePerm("goals");
  const level = Number(formData.get("level") ?? 0);
  const energy_required = Number(formData.get("energy_required") ?? 0);
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const blurb = String(formData.get("blurb") ?? "").trim().slice(0, 400);
  const position = Number(formData.get("position") ?? level) || level;
  const rewards = parseRewards(String(formData.get("rewards") ?? ""));
  const top1_re = Number(formData.get("top1_re") ?? 0) || 0;
  const top2_re = Number(formData.get("top2_re") ?? 0) || 0;
  const top3_re = Number(formData.get("top3_re") ?? 0) || 0;
  if (!level || !title)
    redirect(`/community-goals?error=${encodeURIComponent("A level needs a number and a title.")}`);
  const { error } = await db
    .from("vault_levels")
    .insert({ level, energy_required, title, blurb, rewards, position, active: true, top1_re, top2_re, top3_re });
  if (error) {
    console.error("addVaultLevel", error.message);
    redirect(`/community-goals?error=${encodeURIComponent("Couldn't save , is migration 0038 applied? (level must be unique)")}`);
  }
  revalidatePath("/community-goals");
  redirect("/community-goals?saved=1");
}

export async function updateVaultLevel(formData: FormData): Promise<void> {
  await requirePerm("goals");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const patch = {
    level: Number(formData.get("level") ?? 0),
    energy_required: Number(formData.get("energy_required") ?? 0),
    title: String(formData.get("title") ?? "").trim().slice(0, 80),
    blurb: String(formData.get("blurb") ?? "").trim().slice(0, 400),
    position: Number(formData.get("position") ?? 0),
    rewards: parseRewards(String(formData.get("rewards") ?? "")),
    top1_re: Number(formData.get("top1_re") ?? 0) || 0,
    top2_re: Number(formData.get("top2_re") ?? 0) || 0,
    top3_re: Number(formData.get("top3_re") ?? 0) || 0,
  };
  const { error } = await db.from("vault_levels").update(patch).eq("id", id);
  if (error) {
    console.error("updateVaultLevel", error.message);
    redirect(`/community-goals?error=${encodeURIComponent("Couldn't update that level.")}`);
  }
  revalidatePath("/community-goals");
  redirect("/community-goals?saved=1");
}

export async function toggleVaultLevel(formData: FormData): Promise<void> {
  await requirePerm("goals");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("vault_levels")
    .update({ active: formData.get("active") === "1" })
    .eq("id", id);
  if (error) console.error("toggleVaultLevel", error.message);
  revalidatePath("/community-goals");
}

export async function deleteVaultLevel(formData: FormData): Promise<void> {
  await requirePerm("goals");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("vault_levels").delete().eq("id", id);
  if (error) console.error("deleteVaultLevel", error.message);
  revalidatePath("/community-goals");
}

// posted_at is writable so a post can be backdated to when the thing actually
// happened, rather than when someone got round to writing it up.
function newsPostedAt(formData: FormData): string | undefined {
  const raw = String(formData.get("posted_at") ?? "").trim();
  if (!raw) return undefined;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

export async function addNews(formData: FormData): Promise<void> {
  await requirePerm("news");
  const body = String(formData.get("body") ?? "").trim().slice(0, 500);
  const link_url = String(formData.get("link_url") ?? "").trim().slice(0, 500);
  if (!body)
    redirect(`/news?error=${encodeURIComponent("A post needs something to say.")}`);
  const posted_at = newsPostedAt(formData);
  const { error } = await db.from("news").insert({
    body,
    link_url: link_url || null,
    active: true,
    ...(posted_at ? { posted_at } : {}),
  });
  if (error) {
    console.error("addNews", error.message);
    redirect(`/news?error=${encodeURIComponent("Couldn't save , is migration 0117 applied?")}`);
  }
  revalidatePath("/news");
  redirect("/news?saved=1");
}

export async function updateNews(formData: FormData): Promise<void> {
  await requirePerm("news");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const link_url = String(formData.get("link_url") ?? "").trim().slice(0, 500);
  const posted_at = newsPostedAt(formData);
  const patch = {
    body: String(formData.get("body") ?? "").trim().slice(0, 500),
    link_url: link_url || null,
    ...(posted_at ? { posted_at } : {}),
  };
  const { error } = await db.from("news").update(patch).eq("id", id);
  if (error) {
    console.error("updateNews", error.message);
    redirect(`/news?error=${encodeURIComponent("Couldn't update that post.")}`);
  }
  revalidatePath("/news");
  redirect("/news?saved=1");
}

export async function toggleNews(formData: FormData): Promise<void> {
  await requirePerm("news");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("news")
    .update({ active: formData.get("active") === "1" })
    .eq("id", id);
  if (error) console.error("toggleNews", error.message);
  revalidatePath("/news");
}

export async function deleteNews(formData: FormData): Promise<void> {
  await requirePerm("news");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("news").delete().eq("id", id);
  if (error) console.error("deleteNews", error.message);
  revalidatePath("/news");
}

export async function addStoryNode(formData: FormData): Promise<void> {
  await requirePerm("story");
  const s = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max);
  const title = s("title", 120);
  if (!title)
    redirect(`/story?error=${encodeURIComponent("A node needs a title.")}`);
  const { error } = await db.from("story_nodes").insert({
    kind: s("kind", 20) || "chapter",
    seal: s("seal", 8),
    tag: s("tag", 40),
    duration: s("duration", 40),
    title,
    body: s("body", 1200),
    quote: s("quote", 300),
    outcome: s("outcome", 400),
    position: Number(formData.get("position") ?? 0),
  });
  if (error) {
    console.error("addStoryNode", error.message);
    redirect(`/story?error=${encodeURIComponent("Couldn't save , is migration 0040 applied?")}`);
  }
  revalidatePath("/story");
  redirect("/story?saved=1");
}

export async function updateStoryNode(formData: FormData): Promise<void> {
  await requirePerm("story");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const s = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max);
  const { error } = await db
    .from("story_nodes")
    .update({
      kind: s("kind", 20) || "chapter",
      seal: s("seal", 8),
      tag: s("tag", 40),
      duration: s("duration", 40),
      title: s("title", 120),
      body: s("body", 1200),
      quote: s("quote", 300),
      outcome: s("outcome", 400),
      position: Number(formData.get("position") ?? 0),
    })
    .eq("id", id);
  if (error) {
    console.error("updateStoryNode", error.message);
    redirect(`/story?error=${encodeURIComponent("Couldn't update that node.")}`);
  }
  revalidatePath("/story");
  redirect("/story?saved=1");
}

export async function toggleStoryNode(formData: FormData): Promise<void> {
  await requirePerm("story");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("story_nodes")
    .update({ active: formData.get("active") === "1" })
    .eq("id", id);
  if (error) console.error("toggleStoryNode", error.message);
  revalidatePath("/story");
}

export async function deleteStoryNode(formData: FormData): Promise<void> {
  await requirePerm("story");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("story_nodes").delete().eq("id", id);
  if (error) console.error("deleteStoryNode", error.message);
  revalidatePath("/story");
}

// A first-time reviewer confirms they read the YSWS guidelines. Requires the
// review permission (so only actual reviewers can ack), records the current
// version against their Slack id, then drops them into the review queue.
export async function acknowledgeGuidelines() {
  const access = await requirePerm("review");
  await ackGuidelines(access.session.slackId, GUIDELINES_VERSION);
  redirect("/review");
}

// Escape hatch off the same gate: records the ack (so they aren't bounced back
// to the gate every page load) without requiring the read-through, but pings
// every owner via Pixo DM so a skip never goes unnoticed. Fire-and-forget,
// a Slack hiccup shouldn't block the reviewer from reaching the queue.
export async function skipGuidelines() {
  const access = await requirePerm("review");
  await ackGuidelines(access.session.slackId, GUIDELINES_VERSION);
  const handle = (await slackHandle(access.session.slackId)) ?? access.session.slackId;
  const text = `:fast_forward: <@${access.session.slackId}> (${handle}) skipped the reviewer guidelines gate instead of reading it before entering the review queue.`;
  Promise.all(ownerSlackIds().map((id) => dmUser(id, text))).catch((e) =>
    console.error("skipGuidelines notify", (e as Error).message),
  );
  redirect("/review");
}

export async function createShowNTellRound(formData: FormData): Promise<void> {
  const access = await requirePerm("show_n_tell");
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) return;
  const { error } = await db.from("show_n_tell_rounds").insert({
    title,
    created_by: actorName(access),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/show-n-tell");
}

// Only one round is open at a time (the DB's partial unique index backstops
// this) - closing every other round first means the client just calls this
// on whichever round it wants live, no separate "close the old one" step.
export async function openShowNTellRound(formData: FormData): Promise<void> {
  await requirePerm("show_n_tell");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error: closeError } = await db
    .from("show_n_tell_rounds")
    .update({ is_open: false, closed_at: new Date().toISOString() })
    .eq("is_open", true)
    .neq("id", id);
  if (closeError) throw new Error(closeError.message);
  const { error } = await db
    .from("show_n_tell_rounds")
    .update({ is_open: true, opened_at: new Date().toISOString(), closed_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/show-n-tell");
}

export async function closeShowNTellRound(formData: FormData): Promise<void> {
  await requirePerm("show_n_tell");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db
    .from("show_n_tell_rounds")
    .update({ is_open: false, closed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/show-n-tell");
}

export async function addShowNTellEntry(formData: FormData): Promise<void> {
  const access = await requirePerm("show_n_tell");
  const roundId = Number(formData.get("roundId") ?? 0);
  const projectId = Number(formData.get("projectId") ?? 0);
  if (!roundId || !projectId) return;
  const { error } = await db.from("show_n_tell_entries").insert({
    round_id: roundId,
    project_id: projectId,
    added_by: actorName(access),
  });
  // A duplicate (round_id, project_id) is a double-click, not a real error -
  // the entry's already there either way.
  if (error && !error.message?.includes("duplicate")) throw new Error(error.message);
  revalidatePath("/show-n-tell");
}

export async function removeShowNTellEntry(formData: FormData): Promise<void> {
  await requirePerm("show_n_tell");
  const id = Number(formData.get("id") ?? 0);
  if (!id) return;
  const { error } = await db.from("show_n_tell_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/show-n-tell");
}
