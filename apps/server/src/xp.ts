import { db } from "./db/client.js";
import { earnedProjectHours, earnedCollaboratorHours, EARNED_PROJECT_STATUSES, type EarnedProjectRow } from "./earnedProject.js";
import {
  MAX_LEVEL,
  levelForRe,
  payoutUsdPerHour,
  pxPerHourFor,
  rePerHour,
  reForHours,
  reForProject,
  reForLevel,
} from "./config.generated.js";

// The economy in one line: a project's *tier* (1-4, how ambitious it is) decides
// how much Restoration Energy each hour is worth, RE decides your hourly payout,
// and your level is just a display of RE. Every number lives in
// packages/config/pixl.json - change it there and run `bun run config:sync`.
//
// Note on naming: the database column is `projects.level` and holds the tier
// (1-4). It was named before the player-facing 1-100 level existed. Renaming the
// column is not worth a migration - `tier` is the word everywhere else.
export {
  MAX_LEVEL,
  levelForRe,
  payoutUsdPerHour,
  pxPerHourFor,
  rePerHour,
  reForHours,
  reForProject,
  reForLevel,
};

interface ProjectRow extends EarnedProjectRow {
  approved_hours: number | null;
  hackatime_seconds: number | null;
  level: number | null;
  sidequest_id: number | null;
}

// approved_hours is set by a reviewer; before that lands, fall back to whatever
// Hackatime tracked. Same precedence the payout path uses.
function hoursOf(p: ProjectRow): number {
  const h =
    p.approved_hours != null
      ? Number(p.approved_hours)
      : (Number(p.hackatime_seconds) || 0) / 3600;
  return Number.isFinite(h) ? h : 0;
}

function reOf(p: ProjectRow): number {
  return reForProject(hoursOf(p), Number(p.level) || 1, p.sidequest_id != null);
}

function bankedReOf(p: ProjectRow): number {
  const hours = earnedProjectHours(p);
  return hours === null ? 0 : reForProject(hours, Number(p.level) || 1, p.sidequest_id != null);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Lifetime approved hours - the raw work, before any tier weighting. */
export async function approvedHoursFor(
  userId: string,
  excludeProjectId?: number,
): Promise<number> {
  const [rows, collaborations] = await Promise.all([
    approvedProjectsFor(userId, excludeProjectId),
    bankedCollaborations(userId, excludeProjectId),
  ]);
  return round1(
    rows.reduce((s, p) => s + (earnedProjectHours(p) ?? 0), 0) +
    collaborations.reduce((s, c) => s + c.hours, 0),
  );
}

/** RE awarded directly to a player - not tied to any project. Currently just
 * Core Vault chapter leaderboard prizes (see [[vault-chapter-leaderboard]] /
 * apps/server/src/routes/vault.ts), but any future flat RE grant belongs here
 * too, not stapled onto a project row the way trialBonusRe is. */
export async function bonusReFor(userId: string): Promise<number> {
  const { data } = await db
    .from("vault_chapter_awards")
    .select("re_awarded")
    .eq("user_id", userId);
  return (data ?? []).reduce((s, r) => s + (Number(r.re_awarded) || 0), 0);
}

/**
 * Lifetime Restoration Energy - hours weighted by the tier they were shipped at,
 * plus any RE awarded directly. This is what drives both the payout rate and
 * the player's level.
 */
export async function lifetimeRe(userId: string, excludeProjectId?: number): Promise<number> {
  const [rows, bonus, collaborations] = await Promise.all([
    approvedProjectsFor(userId, excludeProjectId),
    bonusReFor(userId),
    bankedCollaborations(userId, excludeProjectId),
  ]);
  const collaboratorRe = collaborations.reduce((s, c) => s + reForHours(c.hours, c.tier), 0);
  return round1(rows.reduce((s, p) => s + bankedReOf(p), bonus) + collaboratorRe);
}

// Total lifetime RE across every player - the "Core Integrity" figure shown
// in the web shell's topbar. Same math as lifetimeRe() above, but summed in
// two queries instead of once per user (this repo has no per-user loop for
// an aggregate this size).
export async function totalCommunityRe(): Promise<number> {
  const [{ data: projects }, { data: awards }, collaborations] = await Promise.all([
    db
      .from("projects")
      .select("approved_hours, hackatime_seconds, level, sidequest_id, status, is_update, prior_approved_hours")
      .in("status", EARNED_PROJECT_STATUSES)
      .is("banned_at", null),
    db.from("vault_chapter_awards").select("re_awarded"),
    bankedCollaborations(),
  ]);
  const projectRe = ((projects ?? []) as ProjectRow[]).reduce((s, p) => s + bankedReOf(p), 0);
  const bonusRe = (awards ?? []).reduce((s, r) => s + (Number(r.re_awarded) || 0), 0);
  const collaboratorRe = collaborations.reduce((s, c) => s + reForHours(c.hours, c.tier), 0);
  return round1(projectRe + bonusRe + collaboratorRe);
}


/** Approved collaboration RE, including historical (now-removed) collaborators
 * who must not lose earned RE. The server and dashboard each query their own DB.
 * No nested joins: pgCompat does not support them.
 */
async function bankedCollaborations(
  userId?: string,
  excludeProjectId?: number,
): Promise<Array<{ hours: number; tier: number }>> {
  let q = db
    .from("project_collaborators")
    .select("project_id, user_id, approved_hours, prior_approved_hours")
    .in("status", ["accepted", "removed"]);
  if (userId) q = q.eq("user_id", userId);
  const { data: collaborations, error: collabError } = await q;
  if (collabError) throw new Error(`Failed reading approved collaborations: ${collabError.message}`);
  const rows = (collaborations ?? []).filter((c) =>
    !excludeProjectId || Number(c.project_id) !== excludeProjectId
  );
  if (rows.length === 0) return [];

  const { data: projects, error: projectError } = await db
    .from("projects")
    .select("id, user_id, status, is_update, level")
    .in("id", [...new Set(rows.map((c) => Number(c.project_id)))])
    .in("status", EARNED_PROJECT_STATUSES)
    .is("banned_at", null);
  if (projectError) throw new Error(`Failed reading projects for collaborations: ${projectError.message}`);
  const byId = new Map((projects ?? []).map((p) => [Number(p.id), p]));
  const banked: Array<{ hours: number; tier: number }> = [];
  for (const c of rows) {
    const p = byId.get(Number(c.project_id));
    if (!p || p.user_id === c.user_id) continue; // Never count the owner twice.
    const hours = earnedCollaboratorHours(
      { status: String(p.status), is_update: p.is_update === true },
      {
        approved_hours: c.approved_hours == null ? null : Number(c.approved_hours),
        prior_approved_hours: c.prior_approved_hours == null ? null : Number(c.prior_approved_hours),
      },
    );
    if (hours !== null && hours > 0) banked.push({ hours, tier: Number(p.level) || 1 });
  }
  return banked;
}

async function approvedProjectsFor(
  userId: string,
  excludeProjectId?: number,
): Promise<ProjectRow[]> {
  let q = db
    .from("projects")
    .select("id, approved_hours, hackatime_seconds, level, sidequest_id, status, is_update, prior_approved_hours")
    .eq("user_id", userId)
    .in("status", EARNED_PROJECT_STATUSES)
    .is("banned_at", null);
  if (excludeProjectId) q = q.neq("id", excludeProjectId);
  const { data } = await q;
  return ((data ?? []) as ProjectRow[]).filter((p) => earnedProjectHours(p) !== null);
}

/**
 * Ranks players by RE earned during a Core Vault chapter window: from
 * `windowStart` (exclusive; null means "since the beginning") up to now,
 * counted by when each project got its final "approved" verdict, not when
 * the work happened - a project's RE belongs to whichever chapter it landed
 * in. Used for the top-3 chapter leaderboard reward in
 * apps/server/src/routes/vault.ts.
 */
export async function topChapterContributors(
  windowStart: Date | null,
  limit: number,
): Promise<{ userId: string; re: number }[]> {
  let q = db
    .from("review_audits")
    .select(
      "project_id, created_at, projects(user_id, approved_hours, hackatime_seconds, level, sidequest_id, status, is_update, prior_approved_hours, banned_at)",
    )
    .eq("verdict", "approved")
    .order("created_at", { ascending: false });
  if (windowStart) q = q.gt("created_at", windowStart.toISOString());
  const { data } = await q;

  // A project can carry more than one "approved" audit if it was reverted and
  // re-approved - keep only the most recent one per project (rows arrived
  // newest-first) so its RE isn't double-counted.
  const seenProjects = new Set<number>();
  const totals = new Map<string, number>();
  for (const row of data ?? []) {
    const projectId = row.project_id as number;
    if (seenProjects.has(projectId)) continue;
    seenProjects.add(projectId);

    const p = row.projects as
      | (ProjectRow & { user_id: string; status: string; banned_at: string | null })
      | null;
    if (!p || p.banned_at || earnedProjectHours(p) === null) continue;

    totals.set(p.user_id, (totals.get(p.user_id) ?? 0) + bankedReOf(p));
  }

  return [...totals.entries()]
    .map(([userId, re]) => ({ userId, re: round1(re) }))
    .sort((a, b) => b.re - a.re)
    .slice(0, limit);
}

/** Level from lifetime RE, for a player. */
export async function levelFor(userId: string, excludeProjectId?: number): Promise<number> {
  return levelForRe(await lifetimeRe(userId, excludeProjectId));
}

// Total Restoration Energy pooled by the whole community - every approved
// project's tier-weighted hours, summed. Drives the Core Vault's community goals.
//
// This is tier-weighted now, so it is NOT the same unit as the old
// hours-only total. vault_levels.energy_required was seeded in raw hours and has
// to be rescaled to match (roughly x12.5 on the expected tier mix, but that
// factor moves with the mix - the thresholds were flagged as guesses anyway).
export async function communityEnergy(): Promise<number> {
  const [{ data }, { data: awards }, collaborations] = await Promise.all([
    db
      .from("projects")
      .select("approved_hours, hackatime_seconds, level, sidequest_id, status, is_update, prior_approved_hours")
      .in("status", EARNED_PROJECT_STATUSES)
      .is("banned_at", null),
    db.from("vault_chapter_awards").select("re_awarded"),
    bankedCollaborations(),
  ]);
  const projectRe = (data ?? []).reduce((s, p) => s + bankedReOf(p as ProjectRow), 0);
  const awardRe = (awards ?? []).reduce((s, r) => s + (Number(r.re_awarded) || 0), 0);
  const collaboratorRe = collaborations.reduce((s, c) => s + reForHours(c.hours, c.tier), 0);
  return Math.round(projectRe + awardRe + collaboratorRe);
}

// RE sitting in the pipeline: projects that passed a first-pass review and
// are waiting on a final reviewer to confirm (second_review) or on Joe
// (fraud_review) before they'd count toward communityEnergy() above. Uses the
// same approved_hours/level the first-pass reviewer already proposed - not
// yet real RE, just what's queued to become real RE once confirmed, so the
// vault page can show it as a separate, distinctly-colored "in review" figure
// rather than folding it into the confirmed total.
export async function pendingCommunityEnergy(): Promise<number> {
  const { data } = await db
    .from("projects")
    .select("approved_hours, hackatime_seconds, level, sidequest_id, status, is_update, prior_approved_hours")
    .in("status", ["second_review", "fraud_review"])
    .is("banned_at", null);
  // An update's previously approved RE is already banked in communityEnergy.
  // Only its new, not-yet-confirmed portion belongs in the pending figure.
  const projectRe = (data ?? []).reduce((s, p) => {
    const row = p as ProjectRow;
    return s + Math.max(reOf(row) - bankedReOf(row), 0);
  }, 0);
  return Math.round(projectRe);
}
