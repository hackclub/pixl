export type Countdown = { days: number; hours: number; minutes: number; seconds: number };

/** Time left until `deadline`, or null once it has passed. */
export function timeLeft(deadline: Date, now: Date): Countdown | null {
  const ms = deadline.getTime() - now.getTime();
  if (!(ms > 0)) return null;
  const total = Math.floor(ms / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** e.g. "12d 04h 31m 08s". */
export function formatCountdown(c: Countdown): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${c.days}d ${p(c.hours)}h ${p(c.minutes)}m ${p(c.seconds)}s`;
}
