// Pure helpers for the explore pages (projects browser, players directory,
// leaderboards, one player profile). Ported from apps/game/web/explore.js.
// No economy math here: every number shown comes from apps/server.

export type Board = "pixels" | "referrals" | "upvotes";
export const BOARDS: { key: Board; label: string }[] = [
  { key: "pixels", label: "PIXELS" },
  { key: "referrals", label: "REFERRALS" },
  { key: "upvotes", label: "UPVOTES" },
];

export function parseBoard(raw: unknown): Board {
  return raw === "referrals" || raw === "upvotes" ? raw : "pixels";
}

export function boardHref(board: Board): string {
  return board === "pixels" ? "/explore/leaderboard" : `/explore/leaderboard?board=${board}`;
}

export type Tier = "all" | "1" | "2" | "3" | "4";
export type Shipped = "all" | "shipped" | "unshipped";

export interface ProjectFilters {
  q: string;
  tier: Tier;
  shipped: Shipped;
}

const one = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "");

export function parseFilters(sp: Record<string, string | string[] | undefined>): ProjectFilters {
  const q = one(sp.q).trim().slice(0, 64);
  const t = one(sp.tier);
  const s = one(sp.shipped);
  return {
    q,
    tier: t === "1" || t === "2" || t === "3" || t === "4" ? t : "all",
    shipped: s === "shipped" || s === "unshipped" ? s : "all",
  };
}

/** Query string for both the page URL and GET /api/explore/projects ("" when unfiltered). */
export function filtersQuery(f: ProjectFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.tier !== "all") p.set("tier", f.tier);
  if (f.shipped !== "all") p.set("shipped", f.shipped);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function isFiltered(f: ProjectFilters): boolean {
  return !!f.q || f.tier !== "all" || f.shipped !== "all";
}

export function playersQuery(q: string): string {
  const t = q.trim().slice(0, 64);
  return t ? `?q=${encodeURIComponent(t)}` : "";
}

/** Same vocabulary as the owner's projects page: SHIPPED only once approved. */
export function statusInfo(status: unknown): { label: string; tone: "shipped" | "review" | "changes" | "draft"; icon: string } {
  const s = String(status || "draft");
  switch (s) {
    case "approved":
      return { label: "SHIPPED", tone: "shipped", icon: "check" };
    case "shipped":
    case "second_review":
      return { label: "IN REVIEW", tone: "review", icon: "review" };
    case "needs_changes":
      return { label: "NEEDS CHANGES", tone: "changes", icon: "warning" };
    default:
      return { label: s.replace(/_/g, " ").toUpperCase(), tone: "draft", icon: "draft" };
  }
}

export function rankLabel(rank: number): string {
  return `#${rank}`;
}

export function rankClass(rank: number): string {
  return rank >= 1 && rank <= 3 ? `top${rank}` : "";
}

export function initial(name: unknown): string {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

export function hours(seconds: unknown): string {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? `${(n / 3600).toFixed(1)}h` : "";
}

export function timeAgo(iso: unknown, now = Date.now()): string {
  if (typeof iso !== "string" || !iso) return "";
  const t = new Date(iso).getTime();
  const s = (now - t) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { timeZone: "UTC" });
}

export function countdown(iso: unknown, now = Date.now()): string {
  const ms = new Date(String(iso)).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "gone!";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${s}s left`;
}

/** Cosmetic title derived from the server's level, not a stored field. */
export function classForLevel(level: unknown): string {
  const lvl = Number(level ?? 1) || 1;
  if (lvl >= 100) return "PIXL LEGEND";
  if (lvl >= 75) return "ELITE BUILDER";
  if (lvl >= 50) return "MASTER BUILDER";
  if (lvl >= 30) return "SENIOR BUILDER";
  if (lvl >= 15) return "SKILLED BUILDER";
  if (lvl >= 5) return "BUILDER";
  return "ROOKIE BUILDER";
}

export interface ActivityEvent {
  t: string;
  kind: "ship" | "badge";
  name: string;
}

/** Ships + badge unlocks merged, newest first, top 6. */
export function recentActivity(
  projects: { name?: unknown; shipped_at?: unknown }[],
  collectibles: { name?: unknown; unlocked_at?: unknown }[],
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const p of projects)
    if (typeof p.shipped_at === "string" && p.shipped_at) events.push({ t: p.shipped_at, kind: "ship", name: String(p.name ?? "") });
  for (const c of collectibles)
    if (typeof c.unlocked_at === "string" && c.unlocked_at) events.push({ t: c.unlocked_at, kind: "badge", name: String(c.name ?? "") });
  events.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  return events.slice(0, 6);
}

export function joinedYear(iso: unknown): string {
  if (typeof iso !== "string") return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : String(d.getUTCFullYear());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlayerId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

export function upvoteError(code: string | null | undefined): string {
  switch (code) {
    case "own_project":
      return "You can't vote on your own project.";
    case "already_upvoted":
      return "You've already voted on this project.";
    case "not_found":
      return "You can't upvote unshipped projects.";
    default:
      return "Couldn't upvote right now.";
  }
}
