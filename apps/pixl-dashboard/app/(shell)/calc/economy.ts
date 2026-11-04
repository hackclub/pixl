// Payout math for /calc. The ONE place this app touches the economy formulas.
//
// It doesn't re-implement them: rePerHour / reForHours / projectPayoutUsd /
// projectPayoutPx come straight from app/_generated/config.ts, which
// `bun run config:sync` writes from the same template and pixl.json as
// apps/server/src/config.generated.ts (the functions apps/server/src/xp.ts
// credits payouts with). economy.test.ts pins this module against the
// server's copy and a table of server-computed values, so any drift fails CI.
//
// Only imported from Server Components (calc/page.tsx): the browser gets the
// computed numbers, never the formulas (hardened relaunch spec, Section 3).
import {
  config,
  payoutUsdPerHour,
  projectPayoutPx,
  projectPayoutUsd,
  rePerHour,
  reForHours,
} from "@/app/_generated/config";

export { payoutUsdPerHour, projectPayoutPx, projectPayoutUsd, rePerHour, reForHours };

export const economy = config.economy;

export const TIERS = ["T1 Spark", "T2 Signal", "T3 Grid", "T4 Nexus"] as const;

export function clampTier(tier: unknown): number {
  const t = Math.trunc(Number(tier));
  return Number.isFinite(t) ? Math.min(Math.max(t, 1), TIERS.length) : 1;
}

export function clampHours(hours: unknown): number {
  const h = Number(hours);
  return Number.isFinite(h) ? Math.min(Math.max(h, 0), 100_000) : 0;
}

export interface PayoutStats {
  /** Pixels credited, rounded the way the page shows them. */
  px: number;
  /** RE this ship banks, rounded. */
  re: number;
  /** Average dollars per hour, or null for zero hours. */
  avgUsdPerHour: number | null;
}

/** The three numbers the calculator shows, same as the old page's writeStats(). */
export function payoutStats(hours: number, tier: number, reBefore = 0): PayoutStats {
  const usd = projectPayoutUsd(hours, tier, reBefore);
  return {
    px: Math.round(projectPayoutPx(hours, tier, reBefore)),
    re: Math.round(reForHours(hours, tier)),
    avgUsdPerHour: hours > 0 ? usd / hours : null,
  };
}

export const MAX_ROWS = 20;

export interface CalcRow {
  hours: number;
  tier: number;
}

export interface CombinedStats extends PayoutStats {
  /** Stats for each row, in order, each starting from the RE the rows before it banked. */
  rows: PayoutStats[];
  /** Total hours across all rows. */
  hours: number;
}

/**
 * Payout for several projects shipped back to back. The rate ramps with lifetime
 * RE, so each project starts from the base RE plus the RE every earlier row
 * banked (the same sequencing the server applies as ships are approved).
 */
export function combinedStats(rows: readonly CalcRow[], reBefore = 0): CombinedStats {
  let re = reBefore;
  let usd = 0;
  let px = 0;
  let earned = 0;
  let hours = 0;
  const per: PayoutStats[] = [];
  for (const r of rows) {
    per.push(payoutStats(r.hours, r.tier, re));
    usd += projectPayoutUsd(r.hours, r.tier, re);
    px += projectPayoutPx(r.hours, r.tier, re);
    const gained = reForHours(r.hours, r.tier);
    earned += gained;
    re += gained;
    hours += r.hours;
  }
  return { px: Math.round(px), re: Math.round(earned), avgUsdPerHour: hours > 0 ? usd / hours : null, rows: per, hours };
}

/** Parses "hours:tier,hours:tier" (the ?rows= param), clamped and capped at MAX_ROWS. */
export function parseRows(raw: unknown): CalcRow[] {
  if (typeof raw !== "string" || !raw) return [];
  return raw
    .split(",")
    .slice(0, MAX_ROWS)
    .map((part) => {
      const [h, t] = part.split(":");
      return { hours: clampHours(h), tier: clampTier(t) };
    });
}

export function formatRows(rows: readonly CalcRow[]): string {
  return rows.map((r) => `${r.hours}:${r.tier}`).join(",");
}
