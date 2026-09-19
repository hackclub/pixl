
export const BLACKOUT_SLUG = "operation-blackout";
export const OPERATION_LEDGER_REASON = "operation_blackout";
export const OPERATION_REVERT_REASON = "operation_blackout_reverted";

export type OperationStatus = "upcoming" | "active" | "ended" | "paused";
export type EntryStatus =
  | "entered"
  | "shipped"
  | "eligible"
  | "ineligible"
  | "approved"
  | "needs_changes";

export interface OperationClock {
  status: OperationStatus;
  startsAt: Date;
  endsAt: Date;
}

export function effectiveStatus(op: OperationClock, now: Date = new Date()): OperationStatus {
  if (op.status === "ended") return "ended";
  if (now.getTime() >= op.endsAt.getTime()) return "ended";
  if (op.status === "paused") return "paused";
  if (now.getTime() < op.startsAt.getTime()) return "upcoming";
  return "active";
}

export function acceptsEntries(op: OperationClock, now: Date = new Date()): boolean {
  return effectiveStatus(op, now) === "active";
}

export interface EntryWindow {
  start: Date;
  end: Date;
}

export function entryWindow(
  entry: { joinedAt: Date; firstQualifiedShipAt: Date | null },
  op: { startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EntryWindow {
  const start = new Date(Math.max(op.startsAt.getTime(), entry.joinedAt.getTime()));
  const end = entry.firstQualifiedShipAt
    ? new Date(Math.min(entry.firstQualifiedShipAt.getTime(), op.endsAt.getTime()))
    : new Date(Math.min(now.getTime(), op.endsAt.getTime()));
  return { start, end: end.getTime() < start.getTime() ? start : end };
}

export function journalSecondsInWindow(
  entries: { hours: number | null; createdAt: Date | string }[],
  start: Date,
  end: Date,
  opts: { startExclusive?: boolean } = {},
): number {
  let hours = 0;
  for (const e of entries) {
    const t = new Date(e.createdAt).getTime();
    const afterStart = opts.startExclusive ? t > start.getTime() : t >= start.getTime();
    if (afterStart && t <= end.getTime()) hours += Number(e.hours) || 0;
  }
  return Math.round(hours * 3600);
}

export const DEFAULT_GRACE_FIX_CAP_RATIO = 0.25;
export const DEFAULT_GRACE_FIX_CAP_MIN_HOURS = 1;

export interface GraceCapConfig {
  graceFixCapRatio?: number;
  graceFixCapMinHours?: number;
}

export function graceFixCapSeconds(baseSeconds: number, cfg: GraceCapConfig = {}): number {
  const ratio = cfg.graceFixCapRatio ?? DEFAULT_GRACE_FIX_CAP_RATIO;
  const minHours = cfg.graceFixCapMinHours ?? DEFAULT_GRACE_FIX_CAP_MIN_HOURS;
  return Math.max(Math.trunc(minHours * 3600), Math.floor(Math.max(baseSeconds, 0) * ratio));
}

export function eligibleTrackedSeconds(
  baseSeconds: number,
  fixSeconds: number,
  cfg: GraceCapConfig = {},
): number {
  const base = Math.max(baseSeconds, 0);
  return base + Math.min(Math.max(fixSeconds, 0), graceFixCapSeconds(base, cfg));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BlackoutPayoutInput {
  approvedHours: number;
  eligibleHours: number;
  creditHours: number;
  normalUsdRate: number;
  minUsdRate: number;
  pxValueUsd: number;
}

export interface BlackoutPayout {
  hours: number;
  effectiveUsdRate: number;
  grossPx: number;
  upliftPx: number;
}

export function blackoutPayout(input: BlackoutPayoutInput): BlackoutPayout {
  const hours = round2(
    Math.max(Math.min(input.approvedHours, input.eligibleHours, input.creditHours), 0),
  );
  const normal = Math.max(input.normalUsdRate, 0);
  const effectiveUsdRate = Math.max(normal, input.minUsdRate);
  const grossPx = Math.round((hours * effectiveUsdRate) / input.pxValueUsd);
  const normalPx = Math.round((hours * normal) / input.pxValueUsd);
  return { hours, effectiveUsdRate, grossPx, upliftPx: Math.max(grossPx - normalPx, 0) };
}

export type PlayerBlackoutLabel =
  | "entered"
  | "shipped"
  | "awaiting_review"
  | "eligible"
  | "ineligible"
  | "approved"
  | "needs_changes";

const IN_REVIEW = new Set(["shipped", "second_review", "fraud_review"]);

export function playerBlackoutLabel(
  entryStatus: EntryStatus,
  projectStatus: string,
  opts: { systemDecided?: boolean } = {},
): PlayerBlackoutLabel {
  switch (entryStatus) {
    case "entered":
      return "entered";
    case "shipped":
      return projectStatus === "shipped" ? "shipped" : "awaiting_review";
    case "eligible":
      return IN_REVIEW.has(projectStatus) ? "awaiting_review" : "eligible";
    case "ineligible":
      return IN_REVIEW.has(projectStatus) && !opts.systemDecided ? "awaiting_review" : "ineligible";
    case "approved":
      return "approved";
    case "needs_changes":
      return "needs_changes";
  }
}
