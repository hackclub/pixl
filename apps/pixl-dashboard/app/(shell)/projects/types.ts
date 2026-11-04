// Shapes returned by apps/server for the projects pages, plus small display
// helpers. No economy math lives here: payouts, RE and pixel values are only
// ever displayed as the server sent them.
import { config } from "@/app/_generated/config";

export type ProjectStatus =
  | "draft"
  | "shipped"
  | "second_review"
  | "fraud_review"
  | "needs_changes"
  | "approved"
  | string;

export interface Project {
  id: number;
  name: string;
  description: string | null;
  repo_url: string | null;
  demo_url: string | null;
  image_url: string | null;
  status: ProjectStatus;
  kind: "software" | "hardware" | null;
  project_type: string | null;
  is_game: boolean | null;
  level: number | null;
  used_ai: boolean | null;
  ai_notes: string | null;
  needs_funding: boolean | null;
  finished_build: boolean | null;
  funding_usd: number | null;
  bom_url: string | null;
  cart_screenshot_urls: string[] | null;
  hackatime_projects: string[] | null;
  hackatime_seconds: number | null;
  journal_seconds: number | null;
  pixels_earned: number | null;
  approved_hours: number | null;
  sidequest_id: number | null;
  sidequest_name: string | null;
  other_ysws: boolean | null;
  other_ysws_notes: string | null;
  eligibility_attested: boolean | null;
  ship_note: string | null;
  review_note: string | null;
  reject_reason: string | null;
  rejected_at: string | null;
  banned_at: string | null;
  hours_extended_since: string | null;
  is_peak: boolean | null;
  is_owner?: boolean;
  join_code: string | null;
  trial_reward_choice: "pending" | "item" | "pixels" | null;
  trial_prize_name: string | null;
  trial_held_px: number | null;
  trial_prize_px: number | null;
  created_at: string;
  shipped_at: string | null;
}

export interface HtProject {
  name: string;
  seconds: number;
  secondsSinceCutoff?: number;
  beforeCutoff?: boolean;
}

export interface HtStats {
  connected: boolean;
  error?: string;
  projects: HtProject[];
}

export interface Trial {
  id: number;
  name: string;
  region?: string | null;
  description?: string | null;
  brief?: string | null;
  reward?: string | null;
  min_hours?: number | null;
  unlocked?: boolean;
  completed?: boolean;
}

export interface JournalEntry {
  id: string | number;
  title: string | null;
  content: string;
  hours: number | null;
  created_at: string;
  edited_at?: string | null;
}

export interface BlackoutEntry {
  projectId: number;
  label: string;
  firstShipAt?: string | null;
  graceDeadline?: string | null;
}

export interface BlackoutState {
  op: { status: string; endsAt?: string | null } | null;
  entries: Record<number, BlackoutEntry>;
}

export const BLACKOUT_SLUG = "operation-blackout";

export const LEVELS: [string, string][] = [
  ["T1 Spark", "A first spark of Restoration: a simple site, script, or tiny tool."],
  ["T2 Signal", "A focused app, CLI, or game with clean polish: one system back online."],
  ["T3 Grid", "Multiple systems working together: backend, state, infra."],
  ["T4 Nexus", "Deep systems work: complex architecture and serious scope."],
].map(([name, blurb], i) => [name, `${blurb} ${config.economy.tierRePerHour[i]} RE per hour.`]);

export function levelName(level: number | null | undefined): string {
  return LEVELS[Math.min(Math.max((level || 1) - 1, 0), LEVELS.length - 1)][0];
}

export const PROJECT_TYPES: [string, string][] = [
  ["web", "Web Playable"],
  ["windows", "Windows Playable"],
  ["mac", "Mac Playable"],
  ["linux", "Linux Playable"],
  ["cross_platform", "Cross Platform Compatible"],
  ["python", "Python"],
  ["android", "Android Playable"],
  ["ios", "iOS Playable"],
  ["hardware", "Hardware"],
  ["cad", "CAD Models"],
  ["other", "Other / Not Sure"],
];

export const IN_REVIEW = ["shipped", "fraud_review", "second_review"];

export function isInReview(p: Pick<Project, "status">): boolean {
  return IN_REVIEW.includes(String(p.status));
}

// A project can only be pulled back before a reviewer has given a verdict on
// it. Once it is past first pass the server refuses (a maker could otherwise
// unship to dodge a pending verdict), so the button isn't offered either.
export function canUnship(p: Pick<Project, "status">): boolean {
  return String(p.status) === "shipped";
}

export function canShip(p: Pick<Project, "status" | "rejected_at">): boolean {
  return !isInReview(p) && (["draft", "needs_changes", "approved"].includes(String(p.status)) || !!p.rejected_at);
}

/** Status label plus its chip tone (see _components/styles.ts statusChip). */
export function statusInfo(
  p: Pick<Project, "status" | "banned_at" | "rejected_at">,
): [string, "approved" | "shipped" | "needs" | "draft"] {
  if (p.banned_at) return ["BANNED", "needs"];
  if (p.rejected_at) return ["REJECTED", "needs"];
  if (p.status === "approved") return ["APPROVED", "approved"];
  if (isInReview(p)) return ["IN REVIEW", "shipped"];
  if (p.status === "needs_changes") return ["NEEDS CHANGES", "needs"];
  return ["DRAFT", "draft"];
}

export function normalizeProject(raw: Record<string, unknown>): Project {
  return { ...(raw as unknown as Project), id: Number(raw.id) };
}
