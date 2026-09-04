import { supabase } from "./db/client.js";
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

interface ProjectRow {
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

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Lifetime approved hours - the raw work, before any tier weighting. */
export async function approvedHoursFor(
  userId: string,
  excludeProjectId?: number,
): Promise<number> {
  const rows = await approvedProjectsFor(userId, excludeProjectId);
  return round1(rows.reduce((s, p) => s + hoursOf(p), 0));
}

/** RE awarded directly to a player - not tied to any project. Currently just
 * Core Vault chapter leaderboard prizes (see [[vault-chapter-leaderboard]] /
 * apps/server/src/routes/vault.ts), but any future flat RE grant belongs here
 * too, not stapled onto a project row the way trialBonusRe is. */
export async function bonusReFor(userId: string): Promise<number> {
  const { data } = await supabase
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
  const [rows, bonus] = await Promise.all([
    approvedProjectsFor(userId, excludeProjectId),
    bonusReFor(userId),
  ]);
  return round1(rows.reduce((s, p) => s + reOf(p), bonus));
}

async function approvedProjectsFor(
  userId: string,
  excludeProjectId?: number,
): Promise<ProjectRow[]> {
  let q = supabase
    .from("projects")
    .select("id, approved_hours, hackatime_seconds, level, sidequest_id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .is("banned_at", null);
  if (excludeProjectId) q = q.neq("id", excludeProjectId);
  const { data } = await q;
  return (data ?? []) as ProjectRow[];
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
  let q = supabase
    .from("review_audits")
    .select(
      "project_id, created_at, projects(user_id, approved_hours, hackatime_seconds, level, sidequest_id, status, banned_at)",
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
    if (!p || p.status !== "approved" || p.banned_at) continue;

    totals.set(p.user_id, (totals.get(p.user_id) ?? 0) + reOf(p));
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
  const [{ data }, { data: awards }] = await Promise.all([
    supabase
      .from("projects")
      .select("approved_hours, hackatime_seconds, level, sidequest_id")
      .eq("status", "approved")
      .is("banned_at", null),
    supabase.from("vault_chapter_awards").select("re_awarded"),
  ]);
  const projectRe = (data ?? []).reduce((s, p) => s + reOf(p as ProjectRow), 0);
  const awardRe = (awards ?? []).reduce((s, r) => s + (Number(r.re_awarded) || 0), 0);
  return Math.round(projectRe + awardRe);
}

// RE sitting in the pipeline: projects that passed a first-pass review and
// are waiting on a final reviewer to confirm (second_review) or on Joe
// (fraud_review) before they'd count toward communityEnergy() above. Uses the
// same approved_hours/level the first-pass reviewer already proposed - not
// yet real RE, just what's queued to become real RE once confirmed, so the
// vault page can show it as a separate, distinctly-colored "in review" figure
// rather than folding it into the confirmed total.
export async function pendingCommunityEnergy(): Promise<number> {
  const { data } = await supabase
    .from("projects")
    .select("approved_hours, hackatime_seconds, level, sidequest_id")
    .in("status", ["second_review", "fraud_review"])
    .is("banned_at", null);
  const projectRe = (data ?? []).reduce((s, p) => s + reOf(p as ProjectRow), 0);
  return Math.round(projectRe);
}
