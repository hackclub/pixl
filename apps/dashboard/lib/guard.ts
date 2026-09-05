import { redirect } from "next/navigation";
import { getSession, isAllowed, type AdminSession } from "./session";
import {
  getAdmin,
  listReportViewerIds,
  listHelperIds,
  listFulfillerIds,
  listModeratorIds,
  listSuperAdminIds,
} from "./db";

// One permission per area an admin can be given the keys to. Adding to this
// list is all it takes to make a new toggle appear on /admins: the values live
// in admins.permissions (a text[]), so there's no migration, and supers get
// every permission automatically in getAccess below.
//
// Deliberately absent: /admins, /reviewers and /fulfillers. Those hand out
// access itself, so gating them on anything but super would let an admin
// promote their way up.
export const ALL_PERMISSIONS = [
  "warn",
  "ban",
  "notify",
  "review",
  "pixels",
  "shop",
  "fulfillment",
  "events",
  "sidequests",
  "story",
  "goals",
  "news",
  "referrals",
  "ideas",
  "tickets",
  "lookup",
  "show_n_tell",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

// The set shown as toggles on /admins. "review" is granted from the Reviewers
// tab instead, since that flow also handles second-pass status.
export const SUBADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== "review",
) as readonly Permission[];

// Marker stored in an admins row to take reviewing away from an env admin,
// whose review right would otherwise come from ADMIN_SLACK_IDS.
export const NO_REVIEW = "no_review";

// Marker stored in an admins row purely to label someone as having been
// granted the Sponsor role from /admins (see addSponsor in app/actions.ts).
// Not itself a capability , the real access comes from the perms/markers in
// SPONSOR_BASE_PERMS below, granted alongside it. Filtered out of the
// effective perms Set in getAccess just like NO_REVIEW/SECOND_PASS.
export const SPONSOR = "sponsor";

// The permission bundle a new Sponsor is granted in one go: ticket handling
// (answer/resolve/fulfill), warning players, and reviewing (both passes , the
// SECOND_PASS marker is applied alongside this by addSponsor, since it isn't
// a plain Permission). This is only the starting bundle: a super can still
// tick on any other SUBADMIN_PERMISSIONS checkbox for them afterward from the
// normal per-admin form on /admins, same as any other admin.
export const SPONSOR_BASE_PERMS = ["warn", "tickets", "review"] as const satisfies readonly Permission[];

// Marker stored in an admins row to promote a reviewer to final (second-pass)
// reviewer, on top of whoever SECOND_PASS_SLACK_IDS grants.
export const SECOND_PASS = "second_pass";

// Markers restricting a reviewer to one queue. Absent (neither marker) means
// both , these are opt-in restrictions, not opt-in grants, so an ordinary
// reviewer keeps seeing both queues unless a super explicitly narrows them.
export const REVIEW_HARDWARE_ONLY = "review_hardware_only";
export const REVIEW_SOFTWARE_ONLY = "review_software_only";
export type ReviewQueueScope = "software" | "hardware" | "both";

export function reviewQueueScopeFor(permissions?: string[]): ReviewQueueScope {
  if (permissions?.includes(REVIEW_HARDWARE_ONLY)) return "hardware";
  if (permissions?.includes(REVIEW_SOFTWARE_ONLY)) return "software";
  return "both";
}

export interface AdminAccess {
  session: AdminSession;
  isSuper: boolean;
  // Env owner (ADMIN_SLACK_IDS). A subset of isSuper with identical rights ,
  // the flag only exists so the dashboard can show that this one can't be
  // demoted from the UI.
  isOwner: boolean;
  perms: Set<string>;
  canSecondPass: boolean;
  // Which review queue(s) this reviewer may work, see REVIEW_HARDWARE_ONLY.
  reviewQueues: ReviewQueueScope;
}

function envIds(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ownerSlackIds(): string[] {
  return envIds("ADMIN_SLACK_IDS");
}

export function secondPassSlackIds(): string[] {
  return envIds("SECOND_PASS_SLACK_IDS");
}

// Final reviewers do the mandatory second pass and are the only ones who can
// approve (and credit pixels). Comes from SECOND_PASS_SLACK_IDS (if unset,
// super admins qualify) or a SECOND_PASS marker granted from the dashboard.
// isSuper covers the table-backed supers, who the env check can't see.
export function isSecondPassReviewer(
  slackId: string,
  tablePerms?: string[],
  isSuper = false,
): boolean {
  if (tablePerms?.includes(SECOND_PASS)) return true;
  const ids = secondPassSlackIds();
  if (ids.length === 0) return isSuper || isAllowed(slackId);
  return ids.includes(slackId);
}

// Super admins hold every permission (minus review if blocked via NO_REVIEW)
// and are the only ones who can hand permissions out. They come from the
// ADMIN_SLACK_IDS env allow-list (permanent owners) or the super_admins table,
// which supers manage from /admins. Sub-admins live in the admins table with
// an explicit permission set.
export async function isSuperAdmin(slackId: string): Promise<boolean> {
  if (isAllowed(slackId)) return true;
  return (await listSuperAdminIds()).includes(slackId);
}

export async function getAccess(): Promise<AdminAccess | null> {
  const session = await getSession();
  if (!session) return null;
  const [row, isSuper] = await Promise.all([
    getAdmin(session.slackId),
    isSuperAdmin(session.slackId),
  ]);
  const reviewBlocked = row?.permissions.includes(NO_REVIEW) ?? false;
  const canSecondPass =
    isSecondPassReviewer(session.slackId, row?.permissions, isSuper) && !reviewBlocked;
  const isOwner = isAllowed(session.slackId);
  const reviewQueues = reviewQueueScopeFor(row?.permissions);
  if (isSuper) {
    const perms = new Set<string>(ALL_PERMISSIONS);
    if (reviewBlocked) perms.delete("review");
    return { session, isSuper: true, isOwner, perms, canSecondPass, reviewQueues };
  }
  if (!row) return null;
  const perms = new Set(
    row.permissions.filter(
      (p) =>
        p !== NO_REVIEW &&
        p !== SECOND_PASS &&
        p !== SPONSOR &&
        p !== REVIEW_HARDWARE_ONLY &&
        p !== REVIEW_SOFTWARE_ONLY,
    ),
  );
  return { session, isSuper: false, isOwner: false, perms, canSecondPass, reviewQueues };
}

// Signed-in users who lost their access land on /removed instead of the
// login screen, so they know it was on purpose (or who to ping if not).
export async function requireAdmin(): Promise<AdminAccess> {
  const access = await getAccess();
  if (access) return access;
  const session = await getSession();
  redirect(session ? "/removed" : "/login");
}

// perms carries the effective set for supers too (review may be blocked), so
// checks go through it rather than short-circuiting on isSuper.
export function canView(access: AdminAccess, perms: Permission[]): boolean {
  return perms.some((p) => access.perms.has(p));
}

// Page-level gate: sub-admins only reach pages matching one of their
// permissions; everyone else bounces back to the overview.
export async function requirePagePerm(perms: Permission[]): Promise<AdminAccess> {
  const access = await requireAdmin();
  if (!canView(access, perms)) redirect("/");
  return access;
}

// First-time gate for the review queue: a reviewer must have acknowledged the
// current YSWS guidelines version before any /review/* page renders. Call right
// after requirePagePerm(["review"]) in each review page - but NOT on the
// guidelines page itself, or it would redirect to itself forever.
export async function requireGuidelinesAck(access: AdminAccess): Promise<void> {
  const { getGuidelinesAck } = await import("./db");
  const { GUIDELINES_VERSION } = await import("./guidelines");
  const acked = await getGuidelinesAck(access.session.slackId);
  if (acked === null || acked < GUIDELINES_VERSION) redirect("/review/guidelines");
}

export async function requirePerm(perm: Permission): Promise<AdminAccess> {
  const access = await getAccess();
  if (!access) throw new Error("Not signed in");
  if (!access.perms.has(perm))
    throw new Error(`You don't have the "${perm}" permission.`);
  return access;
}

// Reports are a separate, explicit allow-list (report_viewers table) , regular
// admins/sub-admins do NOT get in. A viewer only needs a valid session.
// Moderators (see below) get folded in here too , seeing reports is the
// whole point of the role, so they don't need a second listing.
async function reportAccessIds(): Promise<string[]> {
  const [viewers, mods] = await Promise.all([listReportViewerIds(), listModeratorIds()]);
  return [...new Set([...viewers, ...mods])];
}

export async function isReportViewer(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return (await reportAccessIds()).includes(session.slackId);
}

export async function requireReportViewer(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await reportAccessIds()).includes(session.slackId)) redirect("/");
  return session;
}

// Moderators: a lighter-weight role than sub-admins, its own explicit
// allow-list (moderators table) , same shape as report_viewers, NOT folded
// into owners/sub-admins. Grants: seeing reports (via reportAccessIds
// above), warning players directly, and proposing a ban. They can never ban
// outright , only an admin/owner with the "ban" permission can confirm a
// proposal (see confirmBanProposal/rejectBanProposal in app/actions.ts).
export async function isModerator(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return (await listModeratorIds()).includes(session.slackId);
}

export async function requireModerator(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await listModeratorIds()).includes(session.slackId)) redirect("/");
  return session;
}

// Warn access for the warnPlayer action: either a moderator (their own
// allow-list is the grant) or an admin/sub-admin holding the "warn"
// permission. Lets moderators warn without needing a parallel admins-table
// row just to unlock the one action their role is for. Throws (rather than
// redirecting) since it's called from a form action, not a page load.
export async function requireWarnAccess(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  if ((await listModeratorIds()).includes(session.slackId))
    return `${session.name} (${session.slackId})`;
  const access = await getAccess();
  if (!access || !access.perms.has("warn"))
    throw new Error('You don\'t have the "warn" permission.');
  return `${access.session.name} (${access.session.slackId})`;
}

export async function requireSuper(): Promise<AdminAccess> {
  const access = await getAccess();
  if (!access || !access.isSuper) throw new Error("Super admins only.");
  return access;
}

// Tickets are a helpers surface (the `helpers` table, also managed from the
// Pixorpheus Slack bot). Supers always qualify; everyone else needs either a
// helper listing or the "tickets" permission, so the allow-list and the
// permission toggle are two routes to the same access rather than a trap
// where ticking the box does nothing.
export async function getHelperAccess(): Promise<AdminAccess | null> {
  const session = await getSession();
  if (!session) return null;
  const access = await getAccess();
  if (access && (access.isSuper || access.perms.has("tickets"))) return access;
  if (!(await listHelperIds()).includes(session.slackId)) return null;
  // A pure ticket helper doesn't need an admins-table row - getAccess()
  // returns null for them, so build a permissionless access object straight
  // from their session instead of falling through to "no access".
  return access ?? { session, isSuper: false, isOwner: false, perms: new Set<string>(), canSecondPass: false, reviewQueues: "both" };
}

export async function isHelper(): Promise<boolean> {
  return (await getHelperAccess()) !== null;
}

export async function requireHelper(): Promise<AdminAccess> {
  const access = await getHelperAccess();
  if (access) return access;
  // Not a helper - if they have some other admin standing, bounce to the
  // dashboard home same as before; otherwise treat like requireAdmin.
  if (await getAccess()) redirect("/");
  const session = await getSession();
  redirect(session ? "/removed" : "/login");
}

// Fulfillers work the shop-order queue (claim/credit/ship), the same
// allow-list shape as ticket helpers. Owners always qualify; other sub-admins
// do NOT unless they're explicitly listed as a fulfiller. The final close
// (mark done), reassign, and cancel/refund stay owner-only.
export async function getFulfillerAccess(): Promise<AdminAccess | null> {
  const session = await getSession();
  if (!session) return null;
  const access = await getAccess();
  if (access && (access.isSuper || access.perms.has("fulfillment"))) return access;
  if (!(await listFulfillerIds()).includes(session.slackId)) return null;
  // Same as getHelperAccess above - a pure fulfiller doesn't need an
  // admins-table row.
  return access ?? { session, isSuper: false, isOwner: false, perms: new Set<string>(), canSecondPass: false, reviewQueues: "both" };
}

export async function isFulfiller(): Promise<boolean> {
  return (await getFulfillerAccess()) !== null;
}

export async function requireFulfiller(): Promise<AdminAccess> {
  const access = await getFulfillerAccess();
  if (access) return access;
  if (await getAccess()) redirect("/");
  const session = await getSession();
  redirect(session ? "/removed" : "/login");
}
