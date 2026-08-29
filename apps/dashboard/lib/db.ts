import { decryptPII } from "./crypto";
import { reForProject } from "@/app/_generated/config";

// Orchard Postgres over DATABASE_URL. pgCompat connects lazily, so this module
// stays importable while Next prerenders static pages (e.g. /_not-found)
// where env vars may be absent.
export { db } from "./pgCompat";
import { db } from "./pgCompat";

export interface UserRow {
  id: string;
  oauth_provider: string;
  oauth_id: string;
  display_name: string;
  // Real name from Hack Club OAuth. This is what the dashboard shows , the
  // in-game display_name can drift from it. Empty for players who haven't logged
  // in since real_name was added; call playerLabel() to fall back gracefully.
  real_name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  avatar_url: string | null;
  skin: string;
  slack_id: string | null;
  pixels: number;
  created_at: string;
  // YSWS Unified Database fields , filled in by the player via /account in
  // apps/game/web, not backfillable. birthday drives the "turns 19 mid-review"
  // age-eligibility flag on the review page.
  birthday: string | null;
  address_line1: string;
  address_line2: string;
  address_city: string;
  address_state: string;
  address_country: string;
  address_postal: string;
}

// The name to show for a player in the dashboard: their real (OAuth) name, or
// their in-game display_name if we don't have a real name yet, or a final
// fallback (usually the id). Everything player-facing in the dash goes through
// this so we never surface a self-chosen display_name when a real name exists.
export function playerLabel(
  u: { real_name?: string | null; display_name?: string | null } | null | undefined,
  fallback = "",
): string {
  return (u?.real_name || u?.display_name || fallback).trim();
}

function ageOn(birthday: Date, at: Date): number {
  let age = at.getFullYear() - birthday.getFullYear();
  const m = at.getMonth() - birthday.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birthday.getDate())) age--;
  return age;
}

// Hack Club's YSWS guidelines need an "Override Age Justification" when the
// submitter turns 19 between shipping a project and it being reviewed , flags
// that window so the reviewer can document it. null birthday/shippedAt (most
// players, until they fill in /account) means we can't tell, so no flag.
export function turnedNineteenSinceShipping(
  birthday: string | null | undefined,
  shippedAt: string | null | undefined,
): boolean {
  if (!birthday || !shippedAt) return false;
  const bday = new Date(decryptPII(birthday));
  const shipped = new Date(shippedAt);
  if (Number.isNaN(bday.getTime()) || Number.isNaN(shipped.getTime())) return false;
  return ageOn(bday, shipped) < 19 && ageOn(bday, new Date()) >= 19;
}

export interface ViolationRow {
  id: number;
  user_id: string;
  kind: string;
  content: string;
  created_at: string;
  users?: Pick<UserRow, "id" | "display_name" | "real_name" | "slack_id"> | null;
}

export interface BanRow {
  id: number;
  user_id: string;
  reason: string;
  banned_by: string;
  expires_at: string | null;
  lifted_at: string | null;
  created_at: string;
  users?: Pick<UserRow, "id" | "display_name" | "real_name"> | null;
}

export interface ProjectRow {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  demo_url: string | null;
  hackatime_projects: string[];
  hackatime_seconds: number;
  status: string;
  review_note: string;
  review_note_by: string;
  approved_hours: number | null;
  image_url: string;
  level: number;
  project_type: string | null;
  kind: string;
  needs_funding: boolean;
  funding_usd: number;
  bom_url: string;
  cart_screenshot_urls: string[];
  used_ai: boolean;
  ai_notes: string;
  is_update: boolean;
  update_notes: string;
  ship_note: string;
  other_ysws: boolean;
  other_ysws_notes: string;
  system_note: string;
  imported_ysws_entry_id: string | null;
  imported_from_ysws: string | null;
  imported_ysws_hours: number | null;
  imported_ysws_approved_at: string | null;
  archived_at: string | null;
  rejected_at: string | null;
  reject_reason: string;
  reject_by: string;
  banned_at: string | null;
  ban_reason: string;
  ban_by: string;
  reviewing_by: string;
  reviewing_at: string | null;
  first_pass_by: string;
  first_pass_at: string | null;
  first_pass_note: string;
  first_pass_hours: number | null;
  first_pass_verdict: string | null;
  shipped_at: string | null;
  created_at: string;
  sidequest_id: number | null;
  trial_prize_order_id: number | null;
  eligibility_attested: boolean;
  // Reviewer-only cosmetic flag, see toggleProjectPeak in actions.ts. Never
  // player-set, never affects payout.
  is_peak: boolean;
  // Joe fraud review (joe.fraud.hackclub.com), the second pass. joe_error holds
  // the last submission failure so a stuck project explains itself in the UI.
  joe_project_id: string;
  joe_submitted_at: string | null;
  joe_trust_score: number | null;
  joe_outcome: string;
  joe_reason: string;
  joe_reviewed_at: string | null;
  joe_reviewer: string;
  joe_error: string;
  // Airtable YSWS push (see sendProjectToAirtable in app/actions.ts) - the
  // Airtable record id once this project has been pushed, so a re-send
  // updates the existing row instead of creating a duplicate.
  airtable_record_id: string | null;
  // Reviewer override that counts Hackatime hours from before the global
  // hackatimeCutoff for this one project, see extendHoursCutoff in
  // app/actions.ts. hours_extended_since is the "since" date used the last
  // time it was applied; null means no override is in effect.
  hours_extended_since: string | null;
  hours_extended_by: string;
  hours_extended_note: string;
  // Super-admin-only hold: blocks submitting any verdict on this project
  // while set (still visible in the queue). See holdReview/releaseReviewHold
  // in app/actions.ts. hold_at null = not held.
  hold_at: string | null;
  hold_by: string;
  hold_reason: string;
}

export interface PlayerStateRow {
  user_id: string;
  scene: string;
  pos_x: number;
  pos_y: number;
  direction: string;
  updated_at: string;
}

export interface ModActionRow {
  id: number;
  user_id: string;
  action: string;
  detail: string;
  actor: string;
  created_at: string;
}

export interface AdminRow {
  slack_id: string;
  name: string;
  permissions: string[];
  added_by: string;
  created_at: string;
}

// Cross-link for the Slack Lookup tool: does this Slack ID have a Pixl account?
export async function getPlayerBySlackId(
  slackId: string,
): Promise<Pick<UserRow, "id" | "display_name" | "real_name"> | null> {
  const { data, error } = await db
    .from("users")
    .select("id, display_name, real_name")
    .eq("slack_id", slackId)
    .maybeSingle();
  if (error) {
    console.error("getPlayerBySlackId", error.message);
    return null;
  }
  return data;
}

// Name -> Slack id suggestions for the Slack Lookup tool, so admins don't
// have to go dig a U0… id out of another tab first. Deliberately lighter
// than listPlayers() , no project/violation/ban joins, just enough to pick
// the right person off a short list.
export async function searchPlayerHandles(
  query: string,
  limit = 8,
): Promise<Pick<UserRow, "id" | "display_name" | "real_name" | "slack_id">[]> {
  const like = query.replace(/[,()%*\\]/g, " ").trim();
  if (!like) return [];
  const { data, error } = await db
    .from("users")
    .select("id, display_name, real_name, slack_id")
    .not("slack_id", "is", null)
    .or(`display_name.ilike.%${like}%,real_name.ilike.%${like}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("searchPlayerHandles", error.message);
    return [];
  }
  return data ?? [];
}

export async function getAdmin(slackId: string): Promise<AdminRow | null> {
  const { data, error } = await db
    .from("admins")
    .select("*")
    .eq("slack_id", slackId)
    .maybeSingle();
  if (error) {
    console.error("getAdmin", error.message);
    return null;
  }
  return (data as AdminRow) ?? null;
}

// Which guidelines version this reviewer has acknowledged (null = never).
export async function getGuidelinesAck(slackId: string): Promise<number | null> {
  const { data, error } = await db
    .from("reviewer_guidelines_ack")
    .select("version")
    .eq("slack_id", slackId)
    .maybeSingle();
  if (error) {
    console.error("getGuidelinesAck", error.message);
    return null;
  }
  return data ? Number((data as { version: number }).version) : null;
}

export async function ackGuidelines(slackId: string, version: number): Promise<void> {
  const { error } = await db
    .from("reviewer_guidelines_ack")
    .upsert(
      { slack_id: slackId, version, acked_at: new Date().toISOString() },
      { onConflict: "slack_id" },
    );
  if (error) console.error("ackGuidelines", error.message);
}

export async function listAdmins(): Promise<AdminRow[]> {
  const { data, error } = await db
    .from("admins")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listAdmins", error.message);
    return [];
  }
  return (data ?? []) as AdminRow[];
}

// Player display names keyed by linked Slack id , used as a fallback when the
// Slack handle lookup is unavailable (e.g. missing app keys).
export async function displayNamesBySlackId(ids: string[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return new Map();
  const { data, error } = await db
    .from("users")
    .select("slack_id, display_name, real_name")
    .in("slack_id", clean);
  if (error) {
    console.error("displayNamesBySlackId", error.message);
    return new Map();
  }
  const out = new Map<string, string>();
  for (const u of data ?? []) {
    const label = (u.real_name || u.display_name) as string;
    if (u.slack_id && label) out.set(u.slack_id as string, label);
  }
  return out;
}

export interface TeamLogRow {
  id: number;
  slack_id: string;
  name: string;
  action: string;
  before: string[];
  after: string[];
  actor: string;
  reason: string;
  created_at: string;
}

export async function listTeamLog(limit = 20): Promise<TeamLogRow[]> {
  const { data, error } = await db
    .from("team_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listTeamLog", error.message);
    return [];
  }
  return (data ?? []) as TeamLogRow[];
}

export function banIsActive(b: BanRow): boolean {
  if (b.lifted_at) return false;
  if (!b.expires_at) return true;
  return new Date(b.expires_at).getTime() > Date.now();
}

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  if (error) return 0;
  return n ?? 0;
}

export async function getStats() {
  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const [
    players,
    projects,
    violations,
    violations7d,
    activeBans,
    playersToday,
    playersWeek,
    playersMonth,
    projectsWeek,
  ] = await Promise.all([
    count("users"),
    count("projects"),
    count("violations"),
    count("violations", (q) => q.gte("created_at", weekAgo)),
    count("bans", (q) =>
      q
        .is("lifted_at", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
    ),
    count("users", (q) => q.gte("created_at", todayStart.toISOString())),
    count("users", (q) => q.gte("created_at", weekAgo)),
    count("users", (q) => q.gte("created_at", monthAgo)),
    count("projects", (q) => q.gte("created_at", weekAgo)),
  ]);
  return {
    players,
    projects,
    violations,
    violations7d,
    activeBans,
    playersToday,
    playersWeek,
    playersMonth,
    projectsWeek,
  };
}

export interface GrowthPoint {
  date: string;
  total: number;
  added: number;
}

async function fetchCreatedAts(table: string): Promise<string[]> {
  const out: string[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(table)
      .select("created_at")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error("fetchCreatedAts", table, error.message);
      break;
    }
    const rows = data ?? [];
    for (const r of rows) out.push(r.created_at as string);
    if (rows.length < page) break;
  }
  return out;
}

function bucketDaily(dates: string[], days: number): GrowthPoint[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = today.getTime() - (days - 1) * 86400_000;
  const counts = new Map<string, number>();
  let before = 0;
  for (const iso of dates) {
    if (new Date(iso).getTime() < start) {
      before++;
      continue;
    }
    const key = new Date(iso).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const points: GrowthPoint[] = [];
  let total = before;
  for (let i = 0; i < days; i++) {
    const key = new Date(start + i * 86400_000).toISOString().slice(0, 10);
    const added = counts.get(key) ?? 0;
    total += added;
    points.push({ date: key, total, added });
  }
  return points;
}

export async function getGrowthSeries(days = 30) {
  const [users, projects, violations] = await Promise.all([
    fetchCreatedAts("users"),
    fetchCreatedAts("projects"),
    fetchCreatedAts("violations"),
  ]);
  return {
    players: bucketDaily(users, days),
    projects: bucketDaily(projects, days),
    violations: bucketDaily(violations, days),
  };
}

export interface ProjectWithUser extends ProjectRow {
  users?: Pick<UserRow, "id" | "display_name" | "real_name" | "slack_id" | "birthday"> | null;
}

export interface ShippedProject extends ProjectWithUser {
  hours: number;
  hackatimeHours: number;
  journalHours: number;
  entries: number;
  own?: boolean;
}

export interface IdeaWithUser {
  id: number;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
  banned_at: string | null;
  ban_reason: string;
  ban_by: string;
  users?: Pick<UserRow, "id" | "display_name" | "real_name"> | null;
}

async function hydrateHours(projects: ShippedProject[]): Promise<ShippedProject[]> {
  if (projects.length === 0) return projects;
  const { data: journals } = await db
    .from("project_journals")
    .select("project_id, hours")
    .in("project_id", projects.map((p) => p.id));
  const totals = new Map<number, { h: number; n: number }>();
  for (const j of journals ?? []) {
    const cur = totals.get(j.project_id as number) ?? { h: 0, n: 0 };
    cur.h += Number(j.hours) || 0;
    cur.n += 1;
    totals.set(j.project_id as number, cur);
  }
  for (const p of projects) {
    const cur = totals.get(p.id) ?? { h: 0, n: 0 };
    p.journalHours = Math.round(cur.h * 10) / 10;
    p.hackatimeHours = Math.round(((p.hackatime_seconds ?? 0) / 3600) * 10) / 10;
    p.hours = p.hackatimeHours > 0 ? p.hackatimeHours : p.journalHours;
    p.entries = cur.n;
  }
  return projects;
}

// A project claimed by another reviewer stays hidden from the queue for this long.
export const REVIEW_LOCK_MS = 15 * 60 * 1000;

function claimedByOther(p: ShippedProject, viewer?: string): boolean {
  if (!p.reviewing_by || p.reviewing_by === viewer) return false;
  if (!p.reviewing_at) return false;
  return Date.now() - new Date(p.reviewing_at).getTime() < REVIEW_LOCK_MS;
}

// A reviewer may see their own submission in the queue (flagged) but the
// detail page and actions never let them grade it.
function ownedByViewer(p: ShippedProject, viewer?: string): boolean {
  return !!viewer && !!p.users?.slack_id && p.users.slack_id === viewer;
}

// Review queue: shipped projects oldest-first, hiding anything another reviewer
// is currently reviewing.
export async function listShippedProjects(
  viewer?: string,
  kind?: "software" | "hardware",
): Promise<ShippedProject[]> {
  let q = db
    .from("projects")
    .select("*, users(id, display_name, real_name, slack_id)")
    .eq("status", "shipped")
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q
    .order("shipped_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("listShippedProjects", error.message);
    return [];
  }
  const visible = (data ?? []).filter(
    (p) => !claimedByOther(p as ShippedProject, viewer),
  ) as ShippedProject[];
  for (const p of visible) if (ownedByViewer(p, viewer)) p.own = true;
  return hydrateHours(visible);
}

// Claim a submission for a reviewer. Returns { ok:false, by } if someone else
// holds an active claim.
export async function claimReview(
  projectId: number,
  viewer: string,
): Promise<{ ok: boolean; by?: string }> {
  const { data } = await db
    .from("projects")
    .select("reviewing_by, reviewing_at")
    .eq("id", projectId)
    .single();
  const by = (data?.reviewing_by as string) || "";
  const at = (data?.reviewing_at as string | null) ?? null;
  const active =
    by && by !== viewer && at && Date.now() - new Date(at).getTime() < REVIEW_LOCK_MS;
  if (active) return { ok: false, by };
  await db
    .from("projects")
    .update({ reviewing_by: viewer, reviewing_at: new Date().toISOString() })
    .eq("id", projectId);
  if (by !== viewer) void notifyReviewStarted(projectId);
  return { ok: true };
}

// Tell the owner their project is being looked at right now , at most once
// every 6 hours per project so queue browsing doesn't spam them.
async function notifyReviewStarted(projectId: number): Promise<void> {
  const { data: p } = await db
    .from("projects")
    .select("name, user_id, status")
    .eq("id", projectId)
    .single();
  if (!p || !["shipped", "fraud_review", "second_review"].includes(String(p.status))) return;
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { count } = await db
    .from("mod_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", p.user_id)
    .eq("action", "review_started")
    .eq("detail", p.name)
    .gte("created_at", since);
  if ((count ?? 0) > 0) return;
  await db
    .from("mod_actions")
    .insert({ user_id: p.user_id, action: "review_started", detail: p.name, actor: "system" });
  await db.from("notifications").insert({
    user_id: p.user_id,
    title: "Your project is being reviewed",
    body: `A reviewer is looking at "${p.name}" right now. You'll get the verdict here soon. 👀`,
  });
}

// Second-pass queue: projects that passed a first review and await a final
// reviewer's sign-off, oldest-first, hiding anything another reviewer holds.
export async function listSecondReviewProjects(
  viewer?: string,
  kind?: "software" | "hardware",
): Promise<ShippedProject[]> {
  let q = db
    .from("projects")
    .select("*, users(id, display_name, real_name, slack_id)")
    .eq("status", "second_review")
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q
    .order("first_pass_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("listSecondReviewProjects", error.message);
    return [];
  }
  const visible = (data ?? []).filter((p) => !claimedByOther(p as ShippedProject, viewer));
  return hydrateHours(visible as ShippedProject[]);
}

// Waiting on Joe: not actionable by anyone, shown read-only so a backlog or a
// failed submission is visible instead of silent. Oldest first.
export async function listFraudReviewProjects(): Promise<ShippedProject[]> {
  const { data, error } = await db
    .from("projects")
    .select("*, users(id, display_name, real_name, slack_id)")
    .eq("status", "fraud_review")
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    .order("first_pass_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("listFraudReviewProjects", error.message);
    return [];
  }
  return hydrateHours((data ?? []) as ShippedProject[]);
}

// The next project a reviewer should look at after finishing one, so the review
// flow jumps straight to the next in queue instead of dumping them back on the
// list page. Prefers the same stage they were just working (first pass vs final
// pass), then falls back to the other queue. Skips the project they just closed
// and anything they can't action (their own submission, or a final pass on a
// project they first-passed). Returns null when the queue is empty for them.
export async function nextReviewId(opts: {
  viewer: string; // reviewer slack id
  by: string; // actorName(access) — matches first_pass_by
  canSecondPass: boolean;
  isSuper: boolean;
  excludeId: number;
  prefer: "shipped" | "second_review";
}): Promise<number | null> {
  const { viewer, by, canSecondPass, isSuper, excludeId, prefer } = opts;

  const firstPass = (await listShippedProjects(viewer)).filter(
    (p) => p.id !== excludeId && (isSuper || !p.own),
  );
  const finalPass = canSecondPass
    ? (await listSecondReviewProjects(viewer)).filter(
        (p) =>
          p.id !== excludeId &&
          (isSuper || (p.users?.slack_id !== viewer && p.first_pass_by !== by)),
      )
    : [];

  const order =
    prefer === "second_review" ? [finalPass, firstPass] : [firstPass, finalPass];
  for (const list of order) if (list[0]) return list[0].id;
  return null;
}

// Credit a project's approval to the owner's pixel balance exactly once. The
// atomic insert-and-increment lives in a Postgres function so the game can
// never write pixels and repeats can't double-credit.
export async function creditProjectPixels(
  userId: string,
  projectId: number,
  amount: number,
  hours: number,
  by: string,
): Promise<void> {
  const { error } = await db.rpc("credit_project_pixels", {
    p_user_id: userId,
    p_project_id: projectId,
    p_amount: amount,
    p_hours: hours,
    p_created_by: by,
  });
  if (error) console.error("creditProjectPixels", error.message);
}

// Claw back everything a project was credited (verdict reverted). Returns the
// number of pixels removed, for logging.
export async function revokeProjectPixels(
  userId: string,
  projectId: number,
  by: string,
): Promise<number> {
  const { data, error } = await db.rpc("revoke_project_pixels", {
    p_user_id: userId,
    p_project_id: projectId,
    p_created_by: by,
  });
  if (error) {
    console.error("revokeProjectPixels", error.message);
    return 0;
  }
  return Number(data) || 0;
}

// Net pixels one beneficiary has been credited on a project so far (for delta
// display). Scoped by user_id, not just project_id — a collaborative project
// can have several independent beneficiaries, and credit_project_pixels
// (0081_project_collaborators.sql) scopes its own "already credited" lookup
// the same way.
export async function projectPixelTotal(projectId: number, userId: string): Promise<number> {
  const { data, error } = await db
    .from("pixel_transactions")
    .select("amount")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .in("reason", ["project_approved", "review_reverted"]);
  if (error) {
    console.error("projectPixelTotal", error.message);
    return 0;
  }
  return (data ?? []).reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

// Reviewed: projects that already got a verdict, most-recent first.
export async function listReviewedProjects(): Promise<ShippedProject[]> {
  const { data, error } = await db
    .from("projects")
    .select("*, users(id, display_name, real_name, slack_id)")
    .in("status", ["approved", "needs_changes"])
    .is("archived_at", null)
    .order("shipped_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("listReviewedProjects", error.message);
    return [];
  }
  return hydrateHours((data ?? []) as ShippedProject[]);
}

// Pending-review count for the sidebar badge. With no opts it's the raw global
// count (shipped + second_review). Pass the viewer to get a count that matches
// what they can actually action: second_review items only count for final
// reviewers, and anything another reviewer is actively holding is excluded , so
// the badge never shows work the viewer can't see in their queue.
export async function countPendingReviews(
  opts?: { viewer?: string; canSecondPass?: boolean },
): Promise<number> {
  if (!opts) {
    const { count, error } = await db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("status", ["shipped", "second_review"])
      .is("archived_at", null)
      .is("rejected_at", null)
      .is("banned_at", null);
    if (error) {
      console.error("countPendingReviews", error.message);
      return 0;
    }
    return count ?? 0;
  }
  const statuses = opts.canSecondPass ? ["shipped", "second_review"] : ["shipped"];
  const { data, error } = await db
    .from("projects")
    .select("id, reviewing_by, reviewing_at")
    .in("status", statuses)
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null)
    .limit(500);
  if (error) {
    console.error("countPendingReviews", error.message);
    return 0;
  }
  return (data ?? []).filter(
    (p) => !claimedByOther(p as ShippedProject, opts.viewer),
  ).length;
}

// Second-pass queue count for the "Second pass" tab badge (super-admins
// only) — a cheap head count, same shape as countPendingReviews above.
export async function countSecondPassReviews(): Promise<number> {
  const { count, error } = await db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("status", "second_review")
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null);
  if (error) {
    console.error("countSecondPassReviews", error.message);
    return 0;
  }
  return count ?? 0;
}

async function attachPlayerNames(rows: (ModActionRow & { player_name?: string })[]) {
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length === 0) return;
  const { data: users } = await db.from("users").select("id, display_name, real_name").in("id", ids);
  const names = new Map((users ?? []).map((u) => [u.id as string, (u.real_name || u.display_name) as string]));
  for (const r of rows) r.player_name = names.get(r.user_id) ?? r.user_id;
}

function detailMatchesProject(detail: string, name: string): boolean {
  return detail === name || detail.startsWith(`${name}:`);
}

export interface ReviewAuditRow {
  id: number;
  project_id: number;
  user_id: string;
  reviewer: string;
  verdict: string;
  note: string;
  audit_note: string;
  claimed_hours: number;
  approved_hours: number | null;
  repo_opened: boolean;
  demo_opened: boolean;
  repo_seconds: number;
  demo_seconds: number;
  total_seconds: number;
  created_at: string;
  player_name: string;
  project_name: string;
}

export async function listReviewAudits(
  limit = 50,
  reviewerSlackId?: string,
): Promise<ReviewAuditRow[]> {
  let q = db
    .from("review_audits")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (reviewerSlackId) q = q.ilike("reviewer", `%(${reviewerSlackId})%`);
  const { data, error } = await q;
  if (error) {
    console.error("listReviewAudits", error.message);
    return [];
  }
  const rows = (data ?? []) as ReviewAuditRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const [users, projects] = await Promise.all([
    userIds.length > 0
      ? db.from("users").select("id, display_name, real_name").in("id", userIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? db.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((users.data ?? []).map((u) => [u.id as string, (u.real_name || u.display_name) as string]));
  const projectNames = new Map((projects.data ?? []).map((p) => [p.id as number, p.name as string]));
  for (const r of rows) {
    r.player_name = names.get(r.user_id) ?? r.user_id;
    r.project_name = projectNames.get(r.project_id) ?? `#${r.project_id}`;
  }
  return rows;
}

// Every past review verdict for one project, straight off review_audits'
// project_id FK. Used for the review page's "Past reviews" tab , unlike the
// legacy mod_actions-derived `verdicts` on getProject below (matched by
// user_id + a detail.startsWith(project.name) heuristic, which silently
// drops entries after a rename and excludes banned/first_pass_banned
// entirely), this can't miss a review or a verdict type.
export async function listReviewAuditsForProject(projectId: number): Promise<ReviewAuditRow[]> {
  const { data, error } = await db
    .from("review_audits")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listReviewAuditsForProject", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({ ...(r as ReviewAuditRow), player_name: "", project_name: "" }));
}

// The first pass's structured audit note for one project, so the final
// reviewer's form can start from what the first reviewer already wrote
// instead of a blank page. Null when there isn't one (a re-reviewed project,
// or one force-advanced past fraud review without ever having a first pass).
export async function getFirstPassAuditNote(projectId: number): Promise<string | null> {
  const { data, error } = await db
    .from("review_audits")
    .select("audit_note")
    .eq("project_id", projectId)
    .like("verdict", "first_pass_%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getFirstPassAuditNote", error.message);
    return null;
  }
  return (data?.audit_note as string | undefined) ?? null;
}

export interface ReviewerStats {
  reviews: number;
  approved: number;
  firstPass: number;
  needsChanges: number;
  hoursApproved: number;
  avgSeconds: number;
  repoOpenRate: number;
  flagged: number;
  lastReview: string | null;
}

function emptyReviewerStats(): ReviewerStats {
  return {
    reviews: 0,
    approved: 0,
    firstPass: 0,
    needsChanges: 0,
    hoursApproved: 0,
    avgSeconds: 0,
    repoOpenRate: 0,
    flagged: 0,
    lastReview: null,
  };
}

// A verdict looks rushed if it took under a minute, or if it passed the
// project without the repo ever being opened.
export function auditFlags(a: {
  verdict: string;
  total_seconds: number;
  repo_opened: boolean;
}): string[] {
  const flags: string[] = [];
  if (a.total_seconds > 0 && a.total_seconds < 60) flags.push("under a minute");
  if (
    (a.verdict === "approved" || a.verdict === "first_pass_approved") &&
    !a.repo_opened
  )
    flags.push("repo never opened");
  return flags;
}

// Audits store the reviewer as "Name (SLACKID)" , aggregate per slack id.
export async function reviewerStatsBySlackId(): Promise<Map<string, ReviewerStats>> {
  const rows: {
    reviewer: string;
    verdict: string;
    approved_hours: number | null;
    total_seconds: number;
    repo_opened: boolean;
    created_at: string;
  }[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("review_audits")
      .select("reviewer, verdict, approved_hours, total_seconds, repo_opened, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error("reviewerStatsBySlackId", error.message);
      break;
    }
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < page) break;
  }

  const out = new Map<string, ReviewerStats>();
  const timed = new Map<string, { total: number; n: number; repoOpened: number }>();
  for (const r of rows) {
    const key = /\(([^)]+)\)\s*$/.exec(r.reviewer)?.[1] ?? r.reviewer;
    const s = out.get(key) ?? emptyReviewerStats();
    const t = timed.get(key) ?? { total: 0, n: 0, repoOpened: 0 };
    s.reviews++;
    if (r.verdict === "approved") {
      s.approved++;
      s.hoursApproved += Number(r.approved_hours) || 0;
    } else if (r.verdict === "first_pass_approved") s.firstPass++;
    else if (r.verdict === "needs_changes") s.needsChanges++;
    if (r.total_seconds > 0) {
      t.total += r.total_seconds;
      t.n++;
    }
    if (r.repo_opened) t.repoOpened++;
    if (auditFlags(r).length > 0) s.flagged++;
    if (!s.lastReview || r.created_at > s.lastReview) s.lastReview = r.created_at;
    out.set(key, s);
    timed.set(key, t);
  }
  for (const [key, s] of out) {
    const t = timed.get(key)!;
    s.avgSeconds = t.n > 0 ? Math.round(t.total / t.n) : 0;
    s.repoOpenRate = s.reviews > 0 ? t.repoOpened / s.reviews : 0;
  }
  return out;
}

export interface ReviewPayoutRow {
  id: number;
  project_id: number;
  reviewer: string;
  reviewer_slack_id: string;
  verdict: string;
  status: string;
  full_pixels: number;
  paid_pixels: number;
  cut_pct: number;
  cut_reason: string;
  credited: boolean;
  created_at: string;
  settled_at: string | null;
  project_name?: string;
}

// Pay a reviewer into their linked game account. Returns false when no game
// account matches the slack id , the payout row still records what's owed.
export async function creditReviewerPixels(
  slackId: string,
  amount: number,
): Promise<boolean> {
  if (!slackId || amount <= 0) return false;
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("slack_id", slackId)
    .limit(1)
    .maybeSingle();
  if (!user?.id) return false;
  const { error } = await db.rpc("adjust_user_pixels", {
    p_user_id: user.id,
    p_amount: amount,
    p_reason: "review_payout",
    p_created_by: "payout system",
  });
  if (error) {
    console.error("creditReviewerPixels", error.message);
    return false;
  }
  return true;
}

export async function listReviewPayouts(
  reviewerSlackId?: string,
  limit = 200,
): Promise<ReviewPayoutRow[]> {
  let q = db
    .from("review_payouts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (reviewerSlackId) q = q.eq("reviewer_slack_id", reviewerSlackId);
  const { data, error } = await q;
  if (error) {
    console.error("listReviewPayouts", error.message);
    return [];
  }
  const rows = (data ?? []) as ReviewPayoutRow[];
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  if (projectIds.length > 0) {
    const { data: projects } = await db
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    const names = new Map((projects ?? []).map((p) => [p.id as number, p.name as string]));
    for (const r of rows) r.project_name = names.get(r.project_id) ?? `#${r.project_id}`;
  }
  return rows;
}

export interface PayoutTotals {
  earnedPixels: number;
  paid: number;
  pending: number;
  cut: number;
}

export async function payoutTotalsBySlackId(): Promise<Map<string, PayoutTotals>> {
  const rows: { reviewer_slack_id: string; status: string; paid_pixels: number; cut_pct: number }[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("review_payouts")
      .select("reviewer_slack_id, status, paid_pixels, cut_pct")
      .range(from, from + page - 1);
    if (error) {
      console.error("payoutTotalsBySlackId", error.message);
      break;
    }
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < page) break;
  }
  const out = new Map<string, PayoutTotals>();
  for (const r of rows) {
    const t = out.get(r.reviewer_slack_id) ?? { earnedPixels: 0, paid: 0, pending: 0, cut: 0 };
    if (r.status === "paid") {
      t.paid++;
      t.earnedPixels += Number(r.paid_pixels) || 0;
      if ((Number(r.cut_pct) || 0) > 0) t.cut++;
    } else if (r.status === "pending") t.pending++;
    out.set(r.reviewer_slack_id, t);
  }
  return out;
}

export interface SidequestRow {
  id: number;
  name: string;
  region: string;
  npc: string;
  description: string;
  brief: string;
  reward: string;
  active: boolean;
  position: number;
  created_by: string;
  created_at: string;
  min_hours: number | null;
  prize_shop_item_id: number | null;
}

export async function listSidequests(): Promise<SidequestRow[]> {
  const { data, error } = await db
    .from("sidequests")
    .select("*")
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("listSidequests", error.message);
    return [];
  }
  return (data ?? []) as SidequestRow[];
}

// One row per NPC in the game world, mirroring the @export set on the client's
// scripts/npc.gd. The client spawns these at world load, so an NPC can be added
// or moved here without shipping a new game build.
export interface NpcRow {
  id: number;
  world: string;
  pos_x: number;
  pos_y: number;
  npc_name: string;
  skin: string;
  custom_hair: string;
  custom_sheet: string;
  dialogue: string;
  opens_projects: boolean;
  opens_explore: boolean;
  quest_project: boolean;
  faq: boolean;
  quest_trial: boolean;
  trial_checkin: boolean;
  sidequest_id: number | null;
  quest_offer: string;
  quest_done: string;
  trial_reminder: string;
  wanders: boolean;
  speed: number;
  wander_radius: number;
  min_wait: number;
  max_wait: number;
  active: boolean;
  sort_order: number;
  created_by: string;
  created_at: string;
}

export async function listNpcs(): Promise<NpcRow[]> {
  const { data, error } = await db
    .from("npcs")
    .select("*")
    .order("world", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("listNpcs", error.message);
    return [];
  }
  return (data ?? []) as NpcRow[];
}

export interface PublicStats {
  players: number;
  approvedProjects: number;
  inReview: number;
  totalHours: number;
  pixelsCirculating: number;
  reviews: number;
  shipsSeries: GrowthPoint[];
}

// Aggregates safe to show on the public stats page , nothing personal.
export async function publicStats(days = 30): Promise<PublicStats> {
  const pagedAll = async <T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const out: T[] = [];
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await build(from, from + page - 1);
      if (error) {
        console.error("publicStats paged", error.message);
        break;
      }
      out.push(...((data ?? []) as T[]));
      if ((data ?? []).length < page) break;
    }
    return out;
  };

  const [players, approvedProjects, inReview, reviews, hoursRows, pixelRows, shippedRows] =
    await Promise.all([
      count("users"),
      count("projects", (q) => q.eq("status", "approved").is("banned_at", null)),
      count("projects", (q) =>
        q
          .in("status", ["shipped", "fraud_review", "second_review"])
          .is("archived_at", null)
          .is("rejected_at", null)
          .is("banned_at", null),
      ),
      count("review_audits"),
      pagedAll<{ approved_hours: number | null; hackatime_seconds: number | null }>((a, b) =>
        db
          .from("projects")
          .select("approved_hours, hackatime_seconds")
          .eq("status", "approved")
          .is("banned_at", null)
          .range(a, b),
      ),
      pagedAll<{ pixels: number }>((a, b) => db.from("users").select("pixels").range(a, b)),
      pagedAll<{ shipped_at: string }>((a, b) =>
        db
          .from("projects")
          .select("shipped_at")
          .not("shipped_at", "is", null)
          .order("shipped_at", { ascending: true })
          .range(a, b),
      ),
    ]);

  const totalHours =
    Math.round(
      hoursRows.reduce((s, p) => {
        const h =
          p.approved_hours != null
            ? Number(p.approved_hours)
            : (Number(p.hackatime_seconds) || 0) / 3600;
        return s + (Number.isFinite(h) ? h : 0);
      }, 0) * 10,
    ) / 10;
  const pixelsCirculating = Math.round(
    pixelRows.reduce((s, u) => s + (Number(u.pixels) || 0), 0),
  );
  return {
    players,
    approvedProjects,
    inReview,
    totalHours,
    pixelsCirculating,
    reviews,
    shipsSeries: bucketDaily(shippedRows.map((r) => r.shipped_at), days),
  };
}

export interface GalleryProject {
  id: number;
  name: string;
  description: string;
  image_url: string;
  demo_url: string;
  approved_hours: number | null;
  owner: string;
}

export async function publicGallery(limit = 12): Promise<GalleryProject[]> {
  const { data, error } = await db
    .from("projects")
    .select("id, name, description, image_url, demo_url, approved_hours, users(display_name, real_name)")
    .eq("status", "approved")
    .is("banned_at", null)
    .order("shipped_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("publicGallery", error.message);
    return [];
  }
  return (data ?? []).map((p) => ({
    id: p.id as number,
    name: p.name as string,
    description: (p.description as string) ?? "",
    image_url: (p.image_url as string) ?? "",
    demo_url: (p.demo_url as string) ?? "",
    approved_hours: p.approved_hours as number | null,
    owner: playerLabel(
      p.users as unknown as { display_name?: string; real_name?: string } | null,
      "?",
    ),
  }));
}

export interface DashEventRow {
  id: number;
  type: string;
  name: string;
  config: Record<string, unknown>;
  starts_at: string;
  ends_at: string;
  created_by: string;
  stopped_at: string | null;
  created_at: string;
}

export const EVENT_TYPES: Record<string, string> = {
  bounty: "Bounty",
  community_goal: "Community Goal",
  mystery_merchant: "Mystery Merchant",
  review_blitz: "Review Blitz",
  leaderboard_sprint: "Leaderboard Sprint",
};

export async function listEvents(limit = 100): Promise<DashEventRow[]> {
  const { data, error } = await db
    .from("events")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listEvents", error.message);
    return [];
  }
  return (data ?? []) as DashEventRow[];
}

export async function activeDashEvents(types?: string[]): Promise<DashEventRow[]> {
  const now = new Date().toISOString();
  let q = db
    .from("events")
    .select("*")
    .lte("starts_at", now)
    .gt("ends_at", now)
    .is("stopped_at", null);
  if (types && types.length > 0) q = q.in("type", types);
  const { data, error } = await q;
  if (error) {
    console.error("activeDashEvents", error.message);
    return [];
  }
  return (data ?? []) as DashEventRow[];
}

export async function communityGoalShipCount(ev: DashEventRow): Promise<number> {
  let q = db
    .from("projects")
    .select("id", { count: "exact", head: true })
    .gte("shipped_at", ev.starts_at)
    .lt("shipped_at", ev.ends_at)
    .is("archived_at", null)
    .is("banned_at", null);
  const projectType = String(ev.config.projectType ?? "");
  if (projectType) q = q.eq("project_type", projectType);
  const { count, error } = await q;
  if (error) {
    console.error("communityGoalShipCount", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function bountyClaimCount(eventId: number): Promise<number> {
  const { count, error } = await db
    .from("bounty_claims")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  if (error) {
    console.error("bountyClaimCount", error.message);
    return 0;
  }
  return count ?? 0;
}

export interface InvoiceRow {
  slackId: string;
  reviewer: string;
  payouts: number;
  fullPixels: number;
  paidPixels: number;
  cuts: number;
  uncredited: number;
}

// Per-reviewer payout totals for one calendar month , the numbers whoever
// settles real money needs. Only settled ('paid') payouts count; dollars are
// paidPixels * 0.07 (1px = $0.07).
export async function payoutInvoice(monthStart: Date, monthEnd: Date): Promise<InvoiceRow[]> {
  const rows: {
    reviewer: string;
    reviewer_slack_id: string;
    full_pixels: number;
    paid_pixels: number;
    cut_pct: number;
    credited: boolean;
  }[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("review_payouts")
      .select("reviewer, reviewer_slack_id, full_pixels, paid_pixels, cut_pct, credited")
      .eq("status", "paid")
      .gte("settled_at", monthStart.toISOString())
      .lt("settled_at", monthEnd.toISOString())
      .range(from, from + page - 1);
    if (error) {
      console.error("payoutInvoice", error.message);
      break;
    }
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < page) break;
  }
  const out = new Map<string, InvoiceRow>();
  for (const r of rows) {
    const inv = out.get(r.reviewer_slack_id) ?? {
      slackId: r.reviewer_slack_id,
      reviewer: r.reviewer.replace(/\s*\([^)]*\)\s*$/, "") || r.reviewer_slack_id,
      payouts: 0,
      fullPixels: 0,
      paidPixels: 0,
      cuts: 0,
      uncredited: 0,
    };
    inv.payouts++;
    inv.fullPixels += Number(r.full_pixels) || 0;
    inv.paidPixels += Number(r.paid_pixels) || 0;
    if ((Number(r.cut_pct) || 0) > 0) inv.cuts++;
    if (!r.credited) inv.uncredited++;
    out.set(r.reviewer_slack_id, inv);
  }
  return [...out.values()].sort((a, b) => b.paidPixels - a.paidPixels);
}

export interface PixelTxRow {
  id: number;
  user_id: string;
  project_id: number | null;
  amount: number;
  hours: number;
  reason: string;
  created_by: string;
  created_at: string;
  player_name: string;
  project_name: string | null;
}

// The pixel ledger, newest first: every credit (and, later, spend). amount is
// signed , positive is pixels given out, negative is spent.
export async function listPixelTransactions(limit = 1000): Promise<PixelTxRow[]> {
  const { data, error } = await db
    .from("pixel_transactions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listPixelTransactions", error.message);
    return [];
  }
  const rows = (data ?? []) as PixelTxRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const projectIds = [
    ...new Set(rows.map((r) => r.project_id).filter((x): x is number => x != null)),
  ];
  const [users, projects] = await Promise.all([
    userIds.length > 0
      ? db.from("users").select("id, display_name, real_name").in("id", userIds)
      : Promise.resolve({ data: [] }),
    projectIds.length > 0
      ? db.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map((users.data ?? []).map((u) => [u.id as string, (u.real_name || u.display_name) as string]));
  const pnames = new Map((projects.data ?? []).map((p) => [p.id as number, p.name as string]));
  for (const r of rows) {
    r.player_name = names.get(r.user_id) ?? r.user_id;
    r.project_name = r.project_id != null ? (pnames.get(r.project_id) ?? `#${r.project_id}`) : null;
  }
  return rows;
}

export interface ReportContextLine {
  name: string;
  text: string;
}

export interface ReportRow {
  id: number;
  reporter_id: string;
  target_id: string;
  reason: string;
  context: ReportContextLine[];
  scene: string;
  status: string;
  handled_by: string;
  handled_at: string | null;
  created_at: string;
  anonymous: boolean;
  ai_verdict: string;
  ai_summary: string;
  ai_score: number | null;
  ai_at: string | null;
  reporter_name: string;
  target_name: string;
  target_slack: string | null;
}

// reports has two FKs to users (reporter + target), so names are resolved in a
// second query rather than an embed.
async function hydrateReports(rows: ReportRow[]): Promise<ReportRow[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.target_id]))];
  const users = ids.length
    ? await db.from("users").select("id, display_name, real_name, slack_id").in("id", ids)
    : { data: [] };
  const names = new Map(
    (users.data ?? []).map((u) => [u.id as string, u as { display_name: string; real_name: string; slack_id: string | null }]),
  );
  for (const r of rows) {
    if (!Array.isArray(r.context)) r.context = [];
    r.reporter_name = playerLabel(names.get(r.reporter_id), r.reporter_id);
    r.target_name = playerLabel(names.get(r.target_id), r.target_id);
    r.target_slack = names.get(r.target_id)?.slack_id ?? null;
  }
  return rows;
}

// Player reports, newest first.
export async function listReports(limit = 500): Promise<ReportRow[]> {
  const { data, error } = await db
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listReports", error.message);
    return [];
  }
  return hydrateReports((data ?? []) as ReportRow[]);
}

// Reports filed against one player, newest first , for their profile page.
export async function listReportsAgainst(targetId: string, limit = 50): Promise<ReportRow[]> {
  const { data, error } = await db
    .from("reports")
    .select("*")
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listReportsAgainst", error.message);
    return [];
  }
  return hydrateReports((data ?? []) as ReportRow[]);
}

// How many reports a target has received and a reporter has filed , used to
// flag repeat-reported players and to deanonymize serial reporters.
export async function reportCounts(
  targetId: string,
  reporterId: string,
): Promise<{ againstTarget: number; byReporter: number }> {
  const [t, r] = await Promise.all([
    db.from("reports").select("id", { count: "exact", head: true }).eq("target_id", targetId),
    db.from("reports").select("id", { count: "exact", head: true }).eq("reporter_id", reporterId),
  ]);
  return { againstTarget: t.count ?? 0, byReporter: r.count ?? 0 };
}

export async function getReport(id: number): Promise<ReportRow | null> {
  const { data, error } = await db.from("reports").select("*").eq("id", id).single();
  if (error || !data) return null;
  const [row] = await hydrateReports([data as ReportRow]);
  return row ?? null;
}

export interface ChatLogRow {
  id: number;
  display_name: string;
  text: string;
  scene: string;
  created_at: string;
}

// A player's stored chat over the last `hours`, newest first , the evidence
// for a report.
export async function listChatFor(userId: string, hours = 10): Promise<ChatLogRow[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await db
    .from("chat_messages")
    .select("id, display_name, text, scene, created_at")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("listChatFor", error.message);
    return [];
  }
  return (data ?? []) as ChatLogRow[];
}

export interface ReportViewerRow {
  slack_id: string;
  added_by: string;
  created_at: string;
}

export async function listReportViewerIds(): Promise<string[]> {
  const { data, error } = await db.from("report_viewers").select("slack_id");
  if (error) {
    console.error("listReportViewerIds", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.slack_id as string);
}

export async function listReportViewers(): Promise<ReportViewerRow[]> {
  const { data, error } = await db
    .from("report_viewers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listReportViewers", error.message);
    return [];
  }
  return (data ?? []) as ReportViewerRow[];
}

export async function addReportViewer(slackId: string, by: string): Promise<void> {
  const { error } = await db
    .from("report_viewers")
    .upsert({ slack_id: slackId, added_by: by }, { onConflict: "slack_id" });
  if (error) console.error("addReportViewer", error.message);
}

export async function removeReportViewer(slackId: string): Promise<void> {
  const { error } = await db.from("report_viewers").delete().eq("slack_id", slackId);
  if (error) console.error("removeReportViewer", error.message);
}

// Super admins: the tier that hands out permissions and promotes other super
// admins. Same allow-list shape as the roles below, and additive to the
// ADMIN_SLACK_IDS env owners (see lib/guard.ts) , env owners are permanent and
// never appear here.
export interface SuperAdminRow {
  slack_id: string;
  name: string;
  added_by: string;
  created_at: string;
}

export async function listSuperAdminIds(): Promise<string[]> {
  const { data, error } = await db.from("super_admins").select("slack_id");
  if (error) {
    console.error("listSuperAdminIds", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.slack_id as string);
}

export async function listSuperAdmins(): Promise<SuperAdminRow[]> {
  const { data, error } = await db
    .from("super_admins")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listSuperAdmins", error.message);
    return [];
  }
  return (data ?? []) as SuperAdminRow[];
}

export async function addSuperAdmin(slackId: string, name: string, by: string): Promise<void> {
  const { error } = await db
    .from("super_admins")
    .upsert({ slack_id: slackId, name, added_by: by }, { onConflict: "slack_id" });
  if (error) throw new Error(error.message);
}

export async function removeSuperAdmin(slackId: string): Promise<void> {
  const { error } = await db.from("super_admins").delete().eq("slack_id", slackId);
  if (error) throw new Error(error.message);
}

// Moderators: a lighter-weight role than sub-admins. Listing here folds into
// the report_viewers check (see lib/guard.ts isReportViewer) and lets someone
// warn players directly, but they can only propose a ban , an admin/owner
// with the "ban" permission confirms it. Same allow-list shape as
// report_viewers/helpers/fulfillers.
export interface ModeratorRow {
  slack_id: string;
  name: string;
  added_by: string;
  created_at: string;
}

export async function listModeratorIds(): Promise<string[]> {
  const { data, error } = await db.from("moderators").select("slack_id");
  if (error) {
    console.error("listModeratorIds", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.slack_id as string);
}

export async function listModerators(): Promise<ModeratorRow[]> {
  const { data, error } = await db
    .from("moderators")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listModerators", error.message);
    return [];
  }
  return (data ?? []) as ModeratorRow[];
}

export async function addModerator(slackId: string, name: string, by: string): Promise<void> {
  const { error } = await db
    .from("moderators")
    .upsert({ slack_id: slackId, name, added_by: by }, { onConflict: "slack_id" });
  if (error) console.error("addModerator", error.message);
}

export async function removeModerator(slackId: string): Promise<void> {
  const { error } = await db.from("moderators").delete().eq("slack_id", slackId);
  if (error) console.error("removeModerator", error.message);
}

// Helpers manage the support/ticket queue. Shared with the Pixorpheus bot,
// which reads/writes the same `helpers` table (slack_user_id PK) via its
// /pixl-addhelper etc. commands.
export interface HelperRow {
  slack_user_id: string;
  created_at: string;
}

export async function listHelperIds(): Promise<string[]> {
  const { data, error } = await db.from("helpers").select("slack_user_id");
  if (error) {
    console.error("listHelperIds", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.slack_user_id as string);
}

export async function listHelpers(): Promise<HelperRow[]> {
  const { data, error } = await db
    .from("helpers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listHelpers", error.message);
    return [];
  }
  return (data ?? []) as HelperRow[];
}

export async function addHelper(slackId: string): Promise<void> {
  const { error } = await db
    .from("helpers")
    .upsert({ slack_user_id: slackId }, { onConflict: "slack_user_id" });
  if (error) console.error("addHelper", error.message);
}

export async function removeHelper(slackId: string): Promise<void> {
  const { error } = await db.from("helpers").delete().eq("slack_user_id", slackId);
  if (error) console.error("removeHelper", error.message);
}

// Fulfillers work the shop-order queue. Same shape as the `helpers` table,
// just a separate allow-list since working tickets and working orders are
// different jobs.
export interface FulfillerRow {
  slack_user_id: string;
  created_at: string;
}

export async function listFulfillerIds(): Promise<string[]> {
  const { data, error } = await db.from("fulfillers").select("slack_user_id");
  if (error) {
    console.error("listFulfillerIds", error.message);
    return [];
  }
  return (data ?? []).map((r) => r.slack_user_id as string);
}

export async function listFulfillers(): Promise<FulfillerRow[]> {
  const { data, error } = await db
    .from("fulfillers")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listFulfillers", error.message);
    return [];
  }
  return (data ?? []) as FulfillerRow[];
}

export async function addFulfiller(slackId: string): Promise<void> {
  const { error } = await db
    .from("fulfillers")
    .upsert({ slack_user_id: slackId }, { onConflict: "slack_user_id" });
  if (error) console.error("addFulfiller", error.message);
}

export async function removeFulfiller(slackId: string): Promise<void> {
  const { error } = await db.from("fulfillers").delete().eq("slack_user_id", slackId);
  if (error) console.error("removeFulfiller", error.message);
}

export interface FulfillerStats {
  claimed: number;
  shipped: number;
  done: number;
  inQueue: number;
  avgShipSeconds: number;
  lastActivity: string | null;
}

// Per-fulfiller order stats, keyed by claimed_by_slack , mirrors
// reviewerStatsBySlackId's shape (one query, grouped client-side) so the
// /fulfillers/[id] page can reuse the same Stat-card pattern as /reviewers/[id].
export async function fulfillerStatsBySlackId(): Promise<Map<string, FulfillerStats>> {
  const { data, error } = await db
    .from("shop_orders")
    .select("claimed_by_slack, status, claimed_at, shipped_at, done_at")
    .not("claimed_by_slack", "is", null)
    .neq("claimed_by_slack", "");
  if (error) {
    console.error("fulfillerStatsBySlackId", error.message);
    return new Map();
  }
  const out = new Map<
    string,
    FulfillerStats & { _shipSecondsSum: number; _shipSecondsCount: number }
  >();
  for (const r of data ?? []) {
    const slack = r.claimed_by_slack as string;
    const s = out.get(slack) ?? {
      claimed: 0,
      shipped: 0,
      done: 0,
      inQueue: 0,
      avgShipSeconds: 0,
      lastActivity: null,
      _shipSecondsSum: 0,
      _shipSecondsCount: 0,
    };
    s.claimed += 1;
    if (r.status === "shipped" || r.status === "done") s.shipped += 1;
    if (r.status === "done") s.done += 1;
    if (r.status === "ordered" || r.status === "credited") s.inQueue += 1;
    if (r.claimed_at && r.shipped_at) {
      const secs = (new Date(r.shipped_at).getTime() - new Date(r.claimed_at).getTime()) / 1000;
      if (secs > 0) {
        s._shipSecondsSum += secs;
        s._shipSecondsCount += 1;
      }
    }
    const latest = r.done_at ?? r.shipped_at ?? r.claimed_at;
    if (latest && (!s.lastActivity || latest > s.lastActivity)) s.lastActivity = latest;
    out.set(slack, s);
  }
  const result = new Map<string, FulfillerStats>();
  for (const [slack, s] of out) {
    result.set(slack, {
      claimed: s.claimed,
      shipped: s.shipped,
      done: s.done,
      inQueue: s.inQueue,
      avgShipSeconds: s._shipSecondsCount > 0 ? Math.round(s._shipSecondsSum / s._shipSecondsCount) : 0,
      lastActivity: s.lastActivity,
    });
  }
  return result;
}

export async function countOpenReports(): Promise<number> {
  const { count, error } = await db
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return 0;
  return count ?? 0;
}

export { SHOP_REGIONS, SHOP_REGION_LABELS } from "./shopRegions";
export type { ShopRegion } from "./shopRegions";
import type { ShopRegion } from "./shopRegions";
export { SHOP_CATEGORIES, SHOP_CATEGORY_LABELS } from "./shopCategories";
import type { ShopCategory } from "./shopCategories";
export type { ShopCategory } from "./shopCategories";

export interface ShopItemRow {
  id: number;
  name: string;
  description: string;
  price: number;
  image_url: string;
  options: string[];
  active: boolean;
  position: number;
  created_by: string;
  created_at: string;
  region: ShopRegion;
  unlock_xp: number;
  category: ShopCategory;
  // Sidequest ids that unlock this item; empty = not trial-gated. Comes back as
  // strings from the bigint[] column, so normalize with Number() when comparing.
  unlock_trial_ids: (number | string)[];
}

export interface ShopOptionStockRow {
  choice: string;
  total: number;
  remaining: number;
}

// Per-item, per-choice stock pools (e.g. 15 "Ridit" Signed Org Photos),
// keyed by item id. Items with no pool just aren't in the returned map.
// Reads gracefully as empty before migration 0093 is applied.
export async function listShopOptionStock(itemIds: number[]): Promise<Map<number, ShopOptionStockRow[]>> {
  const map = new Map<number, ShopOptionStockRow[]>();
  if (!itemIds.length) return map;
  const { data, error } = await db
    .from("shop_option_stock")
    .select("item_id, choice, total, remaining")
    .in("item_id", itemIds);
  if (error || !data) return map;
  for (const row of data as { item_id: number; choice: string; total: number; remaining: number }[]) {
    const list = map.get(row.item_id) ?? [];
    list.push({ choice: row.choice, total: row.total, remaining: row.remaining });
    map.set(row.item_id, list);
  }
  return map;
}

// Omit `region` to get every item across all regions (used by the events
// merchant picker, which isn't region-scoped).
export async function listShopItems(region?: ShopRegion): Promise<ShopItemRow[]> {
  let query = db.from("shop_items").select("*");
  if (region) query = query.eq("region", region);
  const { data, error } = await query
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("listShopItems", error.message);
    return [];
  }
  return (data ?? []) as ShopItemRow[];
}

export type OrderStatus =
  | "pending"
  | "ordered"
  | "credited"
  | "shipped"
  | "done"
  | "cancelled";

// The pipeline stages in order, for the stepper. 'cancelled' is off to the side.
export const ORDER_STAGES: OrderStatus[] = ["pending", "ordered", "credited", "shipped", "done"];

export interface ShopOrderRow {
  id: number;
  user_id: string;
  item_id: number | null;
  item_name: string;
  option: string;
  price: number;
  quantity: number;
  status: OrderStatus;
  note: string;
  buyer_note: string;
  stock_choice: string;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string;
  // Pipeline: the one fulfiller who owns the order once it's claimed, plus a
  // stamp per stage and the shipment tracking number DM'd to the buyer.
  claimed_by: string;
  claimed_by_slack: string;
  claimed_at: string | null;
  ordered_at: string | null;
  credited_at: string | null;
  shipped_at: string | null;
  done_at: string | null;
  tracking: string;
  // Over-budget flag: the item can't be sourced for what the player's pixels
  // are worth, so it's parked for an owner instead of ordered.
  flagged_at: string | null;
  flagged_by: string;
  flag_note: string;
  player_name: string;
  player_slack: string | null;
}

// Shop orders players placed with pixels, newest first. Player name + Slack are
// resolved in a follow-up query so the team can reach out about delivery.
export async function listShopOrders(status?: string, limit = 500): Promise<ShopOrderRow[]> {
  let q = db.from("shop_orders").select("*");
  // "flagged" cuts across the stages rather than being one of them , an order
  // is flagged while still sitting at whatever stage it was flagged in.
  if (status === "flagged") q = q.not("flagged_at", "is", null);
  else if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) {
    console.error("listShopOrders", error.message);
    return [];
  }
  const rows = (data ?? []) as ShopOrderRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = ids.length
    ? await db.from("users").select("id, display_name, real_name, slack_id").in("id", ids)
    : { data: [] };
  const names = new Map(
    (users.data ?? []).map((u) => [u.id as string, u as { display_name: string; real_name: string; slack_id: string | null }]),
  );
  for (const r of rows) {
    r.player_name = playerLabel(names.get(r.user_id), r.user_id);
    r.player_slack = names.get(r.user_id)?.slack_id ?? null;
  }
  return rows;
}

// Orders a specific fulfiller has claimed (any stage), newest first , powers
// the order-history table on /fulfillers/[id].
export async function listOrdersForFulfiller(slackId: string, limit = 100): Promise<ShopOrderRow[]> {
  const { data, error } = await db
    .from("shop_orders")
    .select("*")
    .eq("claimed_by_slack", slackId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listOrdersForFulfiller", error.message);
    return [];
  }
  const rows = (data ?? []) as ShopOrderRow[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const users = ids.length
    ? await db.from("users").select("id, display_name, real_name, slack_id").in("id", ids)
    : { data: [] };
  const names = new Map(
    (users.data ?? []).map((u) => [u.id as string, u as { display_name: string; real_name: string; slack_id: string | null }]),
  );
  for (const r of rows) {
    r.player_name = playerLabel(names.get(r.user_id), r.user_id);
    r.player_slack = names.get(r.user_id)?.slack_id ?? null;
  }
  return rows;
}

export async function countPendingOrders(): Promise<number> {
  const { count, error } = await db
    .from("shop_orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    console.error("countPendingOrders", error.message);
    return 0;
  }
  return count ?? 0;
}

export interface FeedItem {
  kind: "mod" | "team" | "review" | "pixels" | "payout";
  text: string;
  detail: string;
  href: string | null;
  when: string;
}

// One merged "what happened lately" stream for the overview, drawn from the
// sources the viewer is allowed to see.
export async function listActivityFeed(opts: {
  mod: boolean;
  review: boolean;
  team: boolean;
  pixels: boolean;
  payouts?: boolean;
  limit?: number;
}): Promise<FeedItem[]> {
  const limit = opts.limit ?? 25;
  const [mods, team, audits, txs, payouts] = await Promise.all([
    opts.mod
      ? db.from("mod_actions").select("*").order("created_at", { ascending: false }).limit(limit)
      : Promise.resolve({ data: [] }),
    opts.team
      ? db.from("team_log").select("*").order("created_at", { ascending: false }).limit(limit)
      : Promise.resolve({ data: [] }),
    opts.review ? listReviewAudits(limit) : Promise.resolve([]),
    opts.pixels
      ? db
          .from("pixel_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [] }),
    opts.payouts ? listReviewPayouts(undefined, limit) : Promise.resolve([]),
  ]);

  const modRows = (mods.data ?? []) as ModActionRow[];
  const txRows = ((txs as { data: unknown[] }).data ?? []) as PixelTxRow[];
  const userIds = [
    ...new Set([...modRows.map((m) => m.user_id), ...txRows.map((t) => t.user_id)]),
  ];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await db.from("users").select("id, display_name, real_name").in("id", userIds);
    for (const u of users ?? []) names.set(u.id as string, (u.real_name || u.display_name) as string);
  }
  const stripId = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "");

  const items: FeedItem[] = [];
  for (const m of modRows)
    items.push({
      kind: "mod",
      text: `${stripId(m.actor)} · ${m.action.replaceAll("_", " ")} · ${names.get(m.user_id) ?? m.user_id}`,
      detail: m.detail,
      href: `/players/${m.user_id}`,
      when: m.created_at,
    });
  for (const t of (team.data ?? []) as TeamLogRow[])
    items.push({
      kind: "team",
      text: `${stripId(t.actor)} · ${t.action} · ${t.name || t.slack_id}`,
      detail: t.reason || `${(t.before ?? []).join(", ") || "nothing"} → ${(t.after ?? []).join(", ") || "nothing"}`,
      href: "/reviewers",
      when: t.created_at,
    });
  for (const a of audits as ReviewAuditRow[])
    items.push({
      kind: "review",
      text: `${stripId(a.reviewer)} · ${a.verdict.replaceAll("_", " ")} · ${a.project_name}`,
      detail: a.note,
      href: `/projects/${a.project_id}`,
      when: a.created_at,
    });
  for (const p of payouts as ReviewPayoutRow[]) {
    const slack = /\(([^)]+)\)\s*$/.exec(p.reviewer)?.[1] ?? p.reviewer_slack_id;
    items.push({
      kind: "payout",
      text:
        p.status === "pending"
          ? `${stripId(p.reviewer)} · payout pending · ${p.project_name}`
          : `${stripId(p.reviewer)} · paid ${p.paid_pixels}/${p.full_pixels} px · ${p.project_name}`,
      detail:
        p.status === "pending"
          ? "awaiting the final pass"
          : p.cut_pct > 0
            ? `cut ${p.cut_pct}% , ${p.cut_reason}`
            : p.credited
              ? "full payout"
              : "full payout , no game account linked",
      href: `/reviewers/${slack}`,
      when: p.settled_at ?? p.created_at,
    });
  }
  for (const t of txRows)
    items.push({
      kind: "pixels",
      text: `${names.get(t.user_id) ?? t.user_id} ${Number(t.amount) >= 0 ? "earned" : "lost"} ${Math.abs(Number(t.amount))} pixels`,
      detail: t.reason.replaceAll("_", " "),
      href: `/players/${t.user_id}`,
      when: t.created_at,
    });

  items.sort((a, b) => (a.when < b.when ? 1 : -1));
  return items.slice(0, limit);
}

export interface BanLogRow extends ModActionRow {
  player_name: string;
}

export async function listBanLog(limit = 100): Promise<BanLogRow[]> {
  const { data, error } = await db
    .from("mod_actions")
    .select("*")
    .in("action", ["ban", "unban"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listBanLog", error.message);
    return [];
  }
  const rows = (data ?? []) as BanLogRow[];
  await attachPlayerNames(rows);
  return rows;
}

// Referral system (see [[referral-system]] in project memory). 1px = $0.07
// (~57px/hr = $4.00/hr base, matching apps/server/src/xp.ts), NOT 10px = $1 ,
// that was a drifted assumption this file used to make; fixed 2026-08-01.
// Cut to roughly a third of the original rates on 2026-08-11 , referral
// payouts were too rich relative to actual submission volume this early;
// revisit once ships from referred players pick up.
// - Referred player: +5px/hr (~$0.35/hr) on top of their normal rate, for
//   their first newly-approved ship only.
// - Referrer: a one-time pixel reward once the referred player's first
//   qualifying ship clears an hour tier, then the contract closes.
// - Every 10th referral a referrer gets rewarded on also pays a milestone.
export const REFERRAL_BOOST_PX_PER_HOUR = 5; // $0.35
export const REFERRAL_BOOST_SHIP_CAP = 1;
export const REFERRAL_MILESTONE_EVERY = 10;
export const REFERRAL_MILESTONE_PX = 119; // $8.33
export const REFERRAL_TIERS: { minHours: number; key: string; px: number }[] = [
  { minHours: 100, key: "100h", px: 190 }, // $13.30
  { minHours: 50, key: "50h", px: 105 }, // $7.35
  { minHours: 25, key: "25h", px: 71 }, // $4.97
  { minHours: 10, key: "10h", px: 33 }, // $2.31
  { minHours: 5, key: "5h", px: 19 }, // $1.33
  { minHours: 2, key: "2h", px: 10 }, // $0.70
];

export function referralTierFor(hours: number): { key: string; px: number } | null {
  return REFERRAL_TIERS.find((t) => hours >= t.minHours) ?? null;
}

export interface ReferralRow {
  id: number;
  referrer_id: string;
  referred_id: string;
  created_at: string;
  rewarded_at: string | null;
  reward_tier: string | null;
  reward_pixels: number | null;
  boosted_ships: number;
  referrer_name: string;
  referred_name: string;
}

// Every referral, newest first, with both sides' names resolved , the
// "referrals" admin page's raw feed.
export async function listReferrals(limit = 500): Promise<ReferralRow[]> {
  const { data, error } = await db
    .from("referrals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listReferrals", error.message);
    return [];
  }
  const rows = (data ?? []) as ReferralRow[];
  const ids = [...new Set(rows.flatMap((r) => [r.referrer_id, r.referred_id]))];
  const names = ids.length
    ? await db.from("users").select("id, display_name, real_name").in("id", ids)
    : { data: [] };
  const nameMap = new Map(
    (names.data ?? []).map((u) => [u.id as string, playerLabel(u as { display_name?: string; real_name?: string }, u.id as string)]),
  );
  for (const r of rows) {
    r.referrer_name = nameMap.get(r.referrer_id) ?? r.referrer_id;
    r.referred_name = nameMap.get(r.referred_id) ?? r.referred_id;
  }
  return rows;
}

export interface ReferrerLeaderboardRow {
  referrerId: string;
  name: string;
  total: number;
  rewarded: number;
  pixelsEarned: number;
  milestones: number;
}

// One row per referrer, ranked by pixels earned from referrals , for the
// top-of-page leaderboard on the referrals admin page.
export async function referrerLeaderboard(rows: ReferralRow[]): Promise<ReferrerLeaderboardRow[]> {
  const out = new Map<string, ReferrerLeaderboardRow>();
  for (const r of rows) {
    const row = out.get(r.referrer_id) ?? {
      referrerId: r.referrer_id,
      name: r.referrer_name,
      total: 0,
      rewarded: 0,
      pixelsEarned: 0,
      milestones: 0,
    };
    row.total++;
    if (r.rewarded_at) {
      row.rewarded++;
      row.pixelsEarned += Number(r.reward_pixels) || 0;
    }
    out.set(r.referrer_id, row);
  }
  for (const row of out.values()) {
    row.milestones = Math.floor(row.rewarded / REFERRAL_MILESTONE_EVERY);
    row.pixelsEarned += row.milestones * REFERRAL_MILESTONE_PX;
  }
  return [...out.values()].sort((a, b) => b.pixelsEarned - a.pixelsEarned);
}

export interface JournalRow {
  id: number;
  project_id: number;
  user_id: string;
  content: string;
  hours: number;
  created_at: string;
  edited_at: string | null;
}

export interface CollaboratorRow {
  id: number;
  project_id: number;
  user_id: string;
  invited_by: string;
  status: string;
  hackatime_projects: string[];
  hackatime_seconds: number | null;
  approved_hours: number | null;
  users?: Pick<UserRow, "id" | "display_name" | "real_name" | "slack_id"> | null;
}

// Accepted (and, for the reviewer's own visibility, pending) collaborators on
// one project — the owner in `projects.user_id` is never included here.
export async function listCollaboratorsForProject(projectId: number): Promise<CollaboratorRow[]> {
  const { data, error } = await db
    .from("project_collaborators")
    .select("*, users(id, display_name, real_name, slack_id)")
    .eq("project_id", projectId)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listCollaboratorsForProject", error.message);
    return [];
  }
  return (data ?? []) as CollaboratorRow[];
}

// Bulk lookup for list views — only accepted collaborators (what's actually
// worth showing next to the owner in a table row).
export async function collaboratorsByProject(
  projectIds: number[],
): Promise<Map<number, CollaboratorRow[]>> {
  const map = new Map<number, CollaboratorRow[]>();
  if (projectIds.length === 0) return map;
  const { data, error } = await db
    .from("project_collaborators")
    .select("*, users(id, display_name, real_name, slack_id)")
    .in("project_id", projectIds)
    .eq("status", "accepted");
  if (error) {
    console.error("collaboratorsByProject", error.message);
    return map;
  }
  for (const row of (data ?? []) as CollaboratorRow[]) {
    const list = map.get(row.project_id) ?? [];
    list.push(row);
    map.set(row.project_id, list);
  }
  return map;
}

export async function getProject(id: number) {
  const { data, error } = await db
    .from("projects")
    .select(
      "*, users(id, display_name, real_name, first_name, last_name, email, slack_id, birthday, address_line1, address_line2, address_city, address_state, address_country, address_postal), sidequests(id, name, region, reward, min_hours)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const project = data as ProjectWithUser;
  const [journals, actions, reviewAudits] = await Promise.all([
    db
      .from("project_journals")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("mod_actions")
      .select("*")
      .eq("user_id", project.user_id)
      .in("action", ["project_approved", "project_first_pass", "project_needs_changes", "review_reverted"])
      .order("created_at", { ascending: false }),
    listReviewAuditsForProject(id),
  ]);
  const verdicts = ((actions.data ?? []) as ModActionRow[]).filter((a) =>
    detailMatchesProject(a.detail, project.name),
  );
  return {
    project,
    journals: (journals.data ?? []) as JournalRow[],
    verdicts,
    reviewAudits,
  };
}

export async function listProjects(
  query?: string,
  opts: { archived?: boolean; includeArchived?: boolean } = {},
): Promise<ProjectWithUser[]> {
  let q = db
    .from("projects")
    .select("*, users(id, display_name, real_name, slack_id)")
    .order("created_at", { ascending: false })
    .limit(500);
  // archived: only archived. includeArchived: both. default: only active.
  if (opts.archived) q = q.not("archived_at", "is", null);
  else if (!opts.includeArchived) q = q.is("archived_at", null);
  if (query) q = q.ilike("name", `%${query}%`);
  const { data, error } = await q;
  if (error) {
    console.error("listProjects", error.message);
    return [];
  }
  return (data ?? []) as ProjectWithUser[];
}

export async function listIdeas(query?: string): Promise<IdeaWithUser[]> {
  let q = db
    .from("ideas")
    .select("*, users(id, display_name, real_name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (query) q = q.ilike("title", `%${query}%`);
  const { data, error } = await q;
  if (error) {
    console.error("listIdeas", error.message);
    return [];
  }
  return (data ?? []) as IdeaWithUser[];
}

export async function listBans(): Promise<BanRow[]> {
  const { data, error } = await db
    .from("bans")
    .select("*, users(id, display_name, real_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("listBans", error.message);
    return [];
  }
  return (data ?? []) as BanRow[];
}

// Ban proposals: a moderator flags a player for a ban; an admin/owner with
// the "ban" permission confirms (which creates the real `bans` row) or
// rejects. See [[moderator-role]] , moderators can never ban directly.
export interface BanProposalRow {
  id: number;
  user_id: string;
  reason: string;
  hours: number;
  proposed_by: string;
  status: "pending" | "confirmed" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  ban_id: number | null;
  created_at: string;
  users?: Pick<UserRow, "id" | "display_name" | "real_name"> | null;
}

export async function listBanProposals(status?: string): Promise<BanProposalRow[]> {
  let q = db
    .from("ban_proposals")
    .select("*, users(id, display_name, real_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) {
    console.error("listBanProposals", error.message);
    return [];
  }
  return (data ?? []) as BanProposalRow[];
}

export async function getBanProposal(id: number): Promise<BanProposalRow | null> {
  const { data, error } = await db
    .from("ban_proposals")
    .select("*, users(id, display_name, real_name)")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as BanProposalRow;
}

export async function insertBanProposal(
  userId: string,
  reason: string,
  hours: number,
  by: string,
): Promise<void> {
  const { error } = await db
    .from("ban_proposals")
    .insert({ user_id: userId, reason, hours, proposed_by: by });
  if (error) console.error("insertBanProposal", error.message);
}

export async function decideBanProposal(
  id: number,
  status: "confirmed" | "rejected",
  by: string,
  banId?: number,
): Promise<void> {
  const { error } = await db
    .from("ban_proposals")
    .update({ status, decided_by: by, decided_at: new Date().toISOString(), ban_id: banId ?? null })
    .eq("id", id);
  if (error) console.error("decideBanProposal", error.message);
}

export async function listViolations(limit = 100): Promise<ViolationRow[]> {
  const { data, error } = await db
    .from("violations")
    .select("*, users(id, display_name, real_name, slack_id)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("listViolations", error.message);
    return [];
  }
  return (data ?? []) as ViolationRow[];
}

export async function listPlayers(query?: string): Promise<
  (UserRow & { projectCount: number; violationCount: number; activeBan: BanRow | null })[]
> {
  let q = db.from("users").select("*").order("created_at", { ascending: false }).limit(500);
  if (query) {
    // Sanitize before interpolating into an or-filter , stray commas/parens
    // would otherwise break PostgREST's filter grammar.
    const like = query.replace(/[,()%*\\]/g, " ").trim();
    q = q.or(`display_name.ilike.%${like}%,real_name.ilike.%${like}%`);
  }
  const { data, error } = await q;
  if (error) {
    console.error("listPlayers", error.message);
    return [];
  }
  const users = (data ?? []) as UserRow[];

  const [projects, violations, bans] = await Promise.all([
    db.from("projects").select("user_id"),
    db.from("violations").select("user_id"),
    db.from("bans").select("*").is("lifted_at", null),
  ]);
  const projCounts = new Map<string, number>();
  for (const p of projects.data ?? [])
    projCounts.set(p.user_id, (projCounts.get(p.user_id) ?? 0) + 1);
  const vioCounts = new Map<string, number>();
  for (const v of violations.data ?? [])
    vioCounts.set(v.user_id, (vioCounts.get(v.user_id) ?? 0) + 1);
  const activeBans = new Map<string, BanRow>();
  for (const b of (bans.data ?? []) as BanRow[])
    if (banIsActive(b)) activeBans.set(b.user_id, b);

  return users.map((u) => ({
    ...u,
    projectCount: projCounts.get(u.id) ?? 0,
    violationCount: vioCounts.get(u.id) ?? 0,
    activeBan: activeBans.get(u.id) ?? null,
  }));
}

export async function getPlayer(id: string) {
  const [user, states, projects, violations, bans, actions] = await Promise.all([
    db.from("users").select("*").eq("id", id).single(),
    db.from("player_state").select("*").eq("user_id", id).order("updated_at", { ascending: false }),
    db.from("projects").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    db.from("violations").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    db.from("bans").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    db.from("mod_actions").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (user.error || !user.data) return null;
  return {
    user: user.data as UserRow,
    states: (states.data ?? []) as PlayerStateRow[],
    projects: (projects.data ?? []) as ProjectRow[],
    violations: (violations.data ?? []) as ViolationRow[],
    bans: (bans.data ?? []) as BanRow[],
    actions: (actions.data ?? []) as ModActionRow[],
  };
}

export async function logModAction(
  userId: string,
  action: string,
  detail: string,
  actor: string,
): Promise<void> {
  const { error } = await db
    .from("mod_actions")
    .insert({ user_id: userId, action, detail, actor });
  if (error) console.error("logModAction", error.message);
}

export interface SearchResults {
  players: { id: string; display_name: string; real_name: string; slack_id: string | null }[];
  projects: { id: number; name: string; status: string; user_id: string }[];
}

export async function globalSearch(
  query: string,
  opts: { players: boolean; projects: boolean },
): Promise<SearchResults> {
  const clean = query.replace(/[,()%*\\]/g, " ").trim();
  if (clean.length < 2) return { players: [], projects: [] };
  const like = `%${clean}%`;

  const [playersRes, projectsRes] = await Promise.all([
    opts.players
      ? db
          .from("users")
          .select("id, display_name, real_name, slack_id")
          .or(`display_name.ilike.${like},real_name.ilike.${like},slack_id.ilike.${like}`)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
    opts.projects
      ? db
          .from("projects")
          .select("id, name, status, user_id")
          .is("archived_at", null)
          .ilike("name", like)
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (playersRes.error) console.error("globalSearch players", playersRes.error.message);
  if (projectsRes.error) console.error("globalSearch projects", projectsRes.error.message);

  return {
    players: (playersRes.data ?? []) as SearchResults["players"],
    projects: (projectsRes.data ?? []) as SearchResults["projects"],
  };
}

export interface NewsRow {
  id: number;
  body: string;
  link_url: string | null;
  posted_at: string;
  active: boolean;
}

// Every post, hidden ones included, since this backs the editor rather than the
// player-facing feed (that one lives on the game server at GET /api/news).
export async function listNews(): Promise<NewsRow[]> {
  const { data, error } = await db
    .from("news")
    .select("*")
    .order("posted_at", { ascending: false });
  if (error) {
    console.error("listNews", error.message);
    return [];
  }
  return (data ?? []) as NewsRow[];
}

export interface VaultReward {
  icon?: string;
  label?: string;
}

export interface VaultLevelRow {
  id: number;
  level: number;
  energy_required: number;
  title: string;
  blurb: string;
  rewards: VaultReward[];
  position: number;
  active: boolean;
  unlocked_at: string | null;
  top1_re: number;
  top2_re: number;
  top3_re: number;
}

export async function listVaultLevels(): Promise<VaultLevelRow[]> {
  const { data, error } = await db
    .from("vault_levels")
    .select("*")
    .order("position", { ascending: true })
    .order("level", { ascending: true });
  if (error) {
    console.error("listVaultLevels", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    ...(r as VaultLevelRow),
    rewards: Array.isArray((r as { rewards?: unknown }).rewards)
      ? ((r as { rewards: VaultReward[] }).rewards)
      : [],
  })) as VaultLevelRow[];
}

export interface StoryNodeRow {
  id: number;
  kind: string;
  seal: string;
  tag: string;
  duration: string;
  title: string;
  body: string;
  quote: string;
  outcome: string;
  position: number;
  active: boolean;
}

export async function listStoryNodes(): Promise<StoryNodeRow[]> {
  const { data, error } = await db
    .from("story_nodes")
    .select("*")
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("listStoryNodes", error.message);
    return [];
  }
  return (data ?? []) as StoryNodeRow[];
}

export interface PixelFlowPoint {
  date: string;
  given: number;
  deducted: number;
}

// Daily pixel flow for the overview chart: positive amounts are pixels given
// out, negative are spent/deducted (charted as a positive magnitude).
export async function getPixelFlowSeries(days = 30): Promise<PixelFlowPoint[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startMs = today.getTime() - (days - 1) * 86400_000;
  const { data, error } = await db
    .from("pixel_transactions")
    .select("amount, created_at")
    .gte("created_at", new Date(startMs).toISOString())
    .limit(50000);
  if (error) {
    console.error("getPixelFlowSeries", error.message);
    return [];
  }
  const given = new Map<string, number>();
  const deducted = new Map<string, number>();
  for (const t of data ?? []) {
    const key = new Date(t.created_at as string).toISOString().slice(0, 10);
    const amt = Number((t as { amount: number }).amount) || 0;
    if (amt >= 0) given.set(key, (given.get(key) ?? 0) + amt);
    else deducted.set(key, (deducted.get(key) ?? 0) + Math.abs(amt));
  }
  const points: PixelFlowPoint[] = [];
  for (let i = 0; i < days; i++) {
    const key = new Date(startMs + i * 86400_000).toISOString().slice(0, 10);
    points.push({ date: key, given: given.get(key) ?? 0, deducted: deducted.get(key) ?? 0 });
  }
  return points;
}

export interface ShopSalesPoint {
  date: string;
  count: number;
}

// Shop activity per day for the shop chart. Purchases aren't enabled yet, so
// this counts trophy claims (shop_claims); it becomes real sales once buying
// goes live and starts writing here.
export async function getShopSalesSeries(days = 30): Promise<ShopSalesPoint[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const startMs = today.getTime() - (days - 1) * 86400_000;
  const { data, error } = await db
    .from("shop_claims")
    .select("claimed_at")
    .gte("claimed_at", new Date(startMs).toISOString())
    .limit(50000);
  if (error) {
    console.error("getShopSalesSeries", error.message);
    return Array.from({ length: days }, (_, i) => ({
      date: new Date(startMs + i * 86400_000).toISOString().slice(0, 10),
      count: 0,
    }));
  }
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const key = new Date((r as { claimed_at: string }).claimed_at).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const key = new Date(startMs + i * 86400_000).toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) ?? 0 };
  });
}

/**
 * A player's lifetime Restoration Energy: every approved project's hours
 * weighted by the tier it was shipped at. This is what sets their payout rate
 * and their level, so both the review UI and the payout path read it from here
 * rather than keeping their own copies - a duplicated rate table drifted once
 * already (40/60 vs the real 50/79, fixed 2026-08-01).
 *
 * The DB column is `projects.level` but holds the tier (1-4); it predates the
 * player-facing 1-100 level and isn't worth a rename migration.
 */
export async function lifetimeRe(userId: string, excludeProjectId?: number): Promise<number> {
  let q = db
    .from("projects")
    .select("id, approved_hours, hackatime_seconds, level, sidequest_id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .is("banned_at", null);
  if (excludeProjectId) q = q.neq("id", excludeProjectId);
  const { data } = await q;
  return (
    Math.round(
      (data ?? []).reduce((s, p) => {
        const h =
          p.approved_hours != null
            ? Number(p.approved_hours)
            : (Number(p.hackatime_seconds) || 0) / 3600;
        return (
          s +
          (Number.isFinite(h)
            ? reForProject(h, Number(p.level) || 1, p.sidequest_id != null)
            : 0)
        );
      }, 0) * 10,
    ) / 10
  );
}
