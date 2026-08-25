// GENERATED from packages/config/pixl.json by `bun run config:sync` - do not edit
/* eslint-disable */
export const config = {
  "name": "Pixl",
  "tagline": "A retro 2D world where you level up by building real things",
  "launchDate": "2026-08-18T11:00:00Z",
  "hackatimeCutoff": "2026-07-18T00:00:00Z",
  "urls": {
    "site": "https://pixl.hackclub.com",
    "play": "https://play.pixl.hackclub.com",
    "docs": "https://pixl.hackclub.com/docs",
    "server": "https://server.pixl.hackclub.com",
    "ws": "wss://server.pixl.hackclub.com/ws",
    "repo": "https://github.com/hackclub/pixl"
  },
  "economy": {
    "pixelValueUsd": 0.07,
    "sponsorRateUsd": 8.5,
    "basePayoutUsd": 3.5,
    "maxPayoutUsd": 6,
    "reForMaxPayout": 7500,
    "payoutSteps": [
      {
        "re": 0,
        "usd": 3.5
      },
      {
        "re": 1250,
        "usd": 3.75
      },
      {
        "re": 2500,
        "usd": 4
      },
      {
        "re": 3750,
        "usd": 4.5
      },
      {
        "re": 5000,
        "usd": 5
      },
      {
        "re": 6250,
        "usd": 5.5
      },
      {
        "re": 7500,
        "usd": 6
      }
    ],
    "tierRePerHour": [
      12.5,
      15,
      18.75,
      25
    ],
    "tierKickerUsdPerStep": 0.5,
    "tierKickerHours": 40,
    "trialBonusRe": 25,
    "levelBands": [
      {
        "throughLevel": 10,
        "rePerLevel": 10
      },
      {
        "throughLevel": 50,
        "rePerLevel": 35
      },
      {
        "throughLevel": 100,
        "rePerLevel": 70
      }
    ]
  },
  "team": [
    "Gabin",
    "Ridit",
    "Ricky"
  ]
} as const;

const E = config.economy;

/** Max player level - the top of the last level band. */
export const MAX_LEVEL = E.levelBands[E.levelBands.length - 1].throughLevel;

/** Restoration Energy earned per hour at a given project tier (1-4). */
export function rePerHour(tier: number): number {
  const t = Math.min(Math.max(Math.trunc(tier) || 1, 1), E.tierRePerHour.length);
  return E.tierRePerHour[t - 1];
}

/** RE a project is worth: its hours at its tier's rate. */
export function reForHours(hours: number, tier: number): number {
  const h = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
  return h * rePerHour(tier);
}

/**
 * RE an approved project actually banks. Same as reForHours, plus a flat bonus
 * when the ship was submitted for a Trial - the same bonus for every Trial, so
 * doing Trials is always worth more than shipping the same hours solo. Anything
 * summing lifetime or community RE has to go through this, not reForHours.
 */
export function reForProject(hours: number, tier: number, forTrial: boolean): number {
  return reForHours(hours, tier) + (forTrial ? E.trialBonusRe : 0);
}

/**
 * Player level from lifetime RE. Levels are cosmetic - they never feed the
 * payout, which comes straight off RE. Early bands are cheap so a beginner on a
 * tier-1 project levels up within a couple of hours; later bands cost more.
 * Caps at MAX_LEVEL, though RE itself keeps accruing past it.
 */
export function levelForRe(re: number): number {
  let remaining = Number.isFinite(re) ? Math.max(re, 0) : 0;
  let level = 0;
  let prevTop = 0;
  for (const band of E.levelBands) {
    const span = band.throughLevel - prevTop;
    const cost = span * band.rePerLevel;
    if (remaining < cost) return level + Math.floor(remaining / band.rePerLevel);
    remaining -= cost;
    level = band.throughLevel;
    prevTop = band.throughLevel;
  }
  return level;
}

/** Total RE needed to reach a given level - the inverse of levelForRe. */
export function reForLevel(level: number): number {
  let re = 0;
  let prevTop = 0;
  for (const band of E.levelBands) {
    const top = Math.min(level, band.throughLevel);
    if (top > prevTop) re += (top - prevTop) * band.rePerLevel;
    prevTop = band.throughLevel;
    if (level <= band.throughLevel) break;
  }
  return re;
}

/**
 * Dollars per hour for a player holding this much lifetime RE. A flat step
 * table, not a curve: E.payoutSteps is sorted ascending by RE, and the rate
 * is whichever step's threshold is the highest one still <= re, capping at
 * maxPayoutUsd once re passes the last step (reForMaxPayout).
 */
export function payoutUsdPerHour(re: number): number {
  const r = Math.max(re, 0);
  let usd: number = E.payoutSteps[0].usd;
  for (const step of E.payoutSteps) {
    if (r < step.re) break;
    usd = step.usd;
  }
  return usd;
}

/** Same rate expressed in pixels, which is what payouts are actually credited in. */
export function pxPerHourFor(re: number): number {
  return payoutUsdPerHour(re) / E.pixelValueUsd;
}

/**
 * The rate for a ship: the step the player's RE sits at once this ship's own
 * RE is added to their lifetime total (reBefore -> reAfter). RE is
 * player-specific and banked forever - once lifetime RE clears a step, every
 * ship from then on pays at that step or higher, this one included.
 *
 * Uses the RE *after* the ship, not an average across the span, so a ship
 * that pushes a player across a step boundary pays the new, higher step for
 * all of its own hours too, not just the hours past the boundary.
 */
export function averageUsdPerHourOver(reBefore: number, reAfter: number): number {
  return payoutUsdPerHour(Math.max(reAfter, reBefore, 0));
}

/** The same averaged rate in pixels. */
export function pxPerHourOver(reBefore: number, reAfter: number): number {
  return averageUsdPerHourOver(reBefore, reAfter) / E.pixelValueUsd;
}

/**
 * Extra dollars a project earns for its tier, on top of the RE-driven rate.
 *
 * The RE ramp alone can't make tier *felt* on a short project: 5 hours moves you
 * a few dozen RE out of the 5000 needed to cap, so a tier-4 5h project paid
 * within a few cents of a tier-1 one. This kicker fixes that - +$0.50/hour per
 * tier step above T1.
 *
 * It only applies to the first `tierKickerHours` of a project, because a long
 * tier-4 project is *already* rewarded: it builds RE five times faster, which
 * permanently lifts the rate on everything shipped afterwards. Without the cap a
 * 150h project's tier gap more than doubles and the margin on exactly the most
 * expensive projects sags. With it, the margin stays flat across project sizes.
 *
 * Known trade-off: this makes splitting one long project into several
 * kicker-length submissions worth something. Reviewers see the submissions, so
 * it is visible rather than silent, but it is a real hole - the pure-RE version
 * had none.
 */
export function tierKickerUsd(hours: number, tier: number): number {
  const t = Math.min(Math.max(Math.trunc(tier) || 1, 1), E.tierRePerHour.length);
  const h = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
  return E.tierKickerUsdPerStep * (t - 1) * Math.min(h, E.tierKickerHours);
}

export function projectPayoutUsd(hours: number, tier: number, reBefore: number): number {
  const h = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
  const reAfter = reBefore + reForHours(h, tier);
  const raw = h * averageUsdPerHourOver(reBefore, reAfter) + tierKickerUsd(h, tier);
  return Math.min(raw, h * E.maxPayoutUsd);
}

/** The same total in pixels - what actually gets credited. */
export function projectPayoutPx(hours: number, tier: number, reBefore: number): number {
  return projectPayoutUsd(hours, tier, reBefore) / E.pixelValueUsd;
}

export const launchDate = new Date(config.launchDate);
export const hackatimeCutoff = new Date(config.hackatimeCutoff);

/** Seconds since epoch - the shape Hackatime's API wants. */
export const hackatimeCutoffUnix = Math.floor(hackatimeCutoff.getTime() / 1000);

export const hasLaunched = (now: Date = new Date()): boolean => now >= launchDate;

/**
 * Always formats in UTC so every app agrees. Local time would put players either
 * side of the date line on different days, which is the drift this file exists
 * to stop.
 */
export function formatDate(
  date: Date,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  locale = "en-US",
): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(date);
}

/** e.g. "Aug 18" - the short form the ship-eligibility copy uses. */
export const hackatimeCutoffLabel = formatDate(hackatimeCutoff);

/** e.g. "August 18, 2026" - the long form the marketing copy uses. */
export const launchDateLabel = formatDate(launchDate, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
