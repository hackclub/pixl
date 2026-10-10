// How the review celebration (confetti, sound, "+6 pixels") gets from the
// server action that records a verdict to the page the reviewer lands on next.
// reviewProject sets this short-lived cookie right before it redirects, the
// ReviewCelebration client component reads it once on arrival and deletes it.
// A plain (not httpOnly) cookie holding a whole number of pixels, nothing else.
export const REVIEW_REWARD_COOKIE = "pixl_review_reward";

// Seconds the cookie lives. Only has to survive one redirect; short so a stale
// one never replays the celebration on a later visit.
export const REVIEW_REWARD_MAX_AGE = 60;

/** Pixels the reviewer was paid for this verdict, or null when the cookie isn't a valid amount. */
export function parseReviewReward(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d{1,6}$/.test(raw)) return null;
  return Number(raw);
}

/** The "+6 pixels" line, or the fallback when the verdict paid nothing. */
export function rewardLabel(px: number): string {
  if (px <= 0) return "Review submitted!";
  return `+${px} ${px === 1 ? "pixel" : "pixels"}`;
}
