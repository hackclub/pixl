// Display formatting shared by the projects pages (server and client safe).
import { config } from "@/app/_generated/config";
import type { HtStats } from "./types";

export function hours(seconds: number | null | undefined): string {
  return ((Number(seconds) || 0) / 3600).toFixed(1) + "h";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC" });
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function shortDate(msOrIso: number | string): string {
  return SHORT.format(typeof msOrIso === "number" ? msOrIso : new Date(msOrIso));
}

export const DEFAULT_CUTOFF_MS = new Date(config.hackatimeCutoff).getTime();

/** The Hackatime cutoff a project counts time from (reviewers can extend it earlier). */
export function projectCutoffMs(hoursExtendedSince: string | null | undefined): number {
  const ms = hoursExtendedSince ? new Date(hoursExtendedSince).getTime() : NaN;
  return Number.isFinite(ms) && ms < DEFAULT_CUTOFF_MS ? ms : DEFAULT_CUTOFF_MS;
}

export function statsPath(cutoffMs: number): string {
  return cutoffMs === DEFAULT_CUTOFF_MS
    ? "/api/hackatime/stats"
    : `/api/hackatime/stats?since=${Math.floor(cutoffMs / 1000)}`;
}

/**
 * Seconds behind a set of ticked Hackatime projects, as the server reported
 * them: `counted` is time after the cutoff (what shipping credits), `total`
 * is everything. A plain sum of server values, no rate math.
 */
export function htTotals(stats: HtStats | null, names: Iterable<string>): { counted: number; total: number } {
  if (!stats || !stats.connected) return { counted: 0, total: 0 };
  const set = new Set(names);
  const picked = stats.projects.filter((h) => set.has(h.name));
  return {
    counted: picked.reduce((s, h) => s + (h.secondsSinceCutoff ?? h.seconds), 0),
    total: picked.reduce((s, h) => s + h.seconds, 0),
  };
}

/** Why the ticked Hackatime time doesn't clear the 1h floor yet. */
export function htBlockerText(stats: HtStats | null, names: Iterable<string>, cutoffMs: number): string {
  const { counted, total } = htTotals(stats, names);
  const label = shortDate(cutoffMs);
  if (!stats || !stats.connected) return "connect Hackatime so your hours can count";
  if (total === 0) return "link a Hackatime project with at least 1h";
  if (counted === 0)
    return Date.now() < cutoffMs
      ? `wait for ${label}: only hours tracked from then on count, and your ${hours(total)} is all logged before it`
      : `track time from ${label} onward: your ${hours(total)} was all logged before then`;
  return `at least 1h tracked from ${label} onward (you have ${hours(counted)} of ${hours(total)})`;
}

// Mirrors the server's journal validation (apps/server/src/routes/projects.ts)
// so the composer hint matches what a post will be checked against. These
// are content rules, not economy formulas.
export function journalCharsNeeded(h: number): number {
  return h > 0 ? Math.max(100, Math.round(h * 100)) : 0;
}
export function journalImagesNeeded(h: number): number {
  return Math.max(1, Math.ceil(h / 4));
}
export function countJournalImages(content: string): number {
  return (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
}
/** Characters that count toward the writing minimum; screenshots are evidence, not text. */
export function journalTextLength(content: string): number {
  return content.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim().length;
}

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "loom.com", "streamable.com", "drive.google.com"];
function host(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
export const isVideoUrl = (url: string) => VIDEO_HOSTS.includes(host(url) ?? "");
export const isKicanvasUrl = (url: string) => host(url) === "kicanvas.org";
