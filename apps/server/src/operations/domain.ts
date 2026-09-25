
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

// Eligibility never depends on shipping/review timing - only on the
// operation's own clock and when this entry opted in. The end is always
// min(now, operation end), never the first-ship instant: work continues to
// count for as long as it happens before Blackout ends, whether the ship
// that surfaces it lands early, late, or long after the operation is over.
export function entryWindow(
  entry: { joinedAt: Date },
  op: { startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): EntryWindow {
  const start = new Date(Math.max(op.startsAt.getTime(), entry.joinedAt.getTime()));
  const end = new Date(Math.min(now.getTime(), op.endsAt.getTime()));
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

// How operation.rateUsd is applied on top of a contributor's own normal
// rate. "floor" (the old, wrong Blackout behavior) means nobody drops below
// a fixed rate regardless of how high their own rate already is - a $6/hr
// player got no uplift at all under a $5 floor. "additive" means everyone
// gets the same flat bonus on top of their own rate, which is what Blackout
// is actually supposed to be: rateUsd IS the bonus (e.g. 1 for +$1/hr), not
// a minimum. Kept generic (not hardcoded to Blackout) so a future operation
// can still use a floor if that's ever the right shape for it.
export type RateMode = "floor" | "additive";

export interface BlackoutPayoutInput {
  approvedHours: number;
  eligibleHours: number;
  creditHours: number;
  normalUsdRate: number;
  /** Meaning depends on rateMode: the floor value ("floor") or the flat
   * bonus added on top of normalUsdRate ("additive"). */
  rateUsd: number;
  rateMode: RateMode;
  pxValueUsd: number;
}

export interface BlackoutPayout {
  hours: number;
  effectiveUsdRate: number;
  grossPx: number;
  upliftPx: number;
}

export function effectiveUsdRate(normalUsdRate: number, rateUsd: number, rateMode: RateMode): number {
  const normal = Math.max(normalUsdRate, 0);
  const rate = Math.max(rateUsd, 0);
  return rateMode === "additive" ? normal + rate : Math.max(normal, rate);
}

export function blackoutPayout(input: BlackoutPayoutInput): BlackoutPayout {
  const hours = round2(
    Math.max(Math.min(input.approvedHours, input.eligibleHours, input.creditHours), 0),
  );
  const normal = Math.max(input.normalUsdRate, 0);
  const effRate = effectiveUsdRate(normal, input.rateUsd, input.rateMode);
  const grossPx = Math.round((hours * effRate) / input.pxValueUsd);
  const normalPx = Math.round((hours * normal) / input.pxValueUsd);
  return { hours, effectiveUsdRate: effRate, grossPx, upliftPx: Math.max(grossPx - normalPx, 0) };
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
