// The "when can I resubmit" sentence added to a changes-requested message
// around the submission deadline. Mirrors the server's rule in
// apps/server/src/submissionDeadline.ts, keep the two in step:
// - requested in the 24h before the deadline: resubmit until deadline + 48h;
// - requested after the deadline: resubmit within 24h of the request;
// - requested earlier: nothing to add, the player can still resubmit normally.

const HOUR_MS = 3_600_000;
const ELIGIBLE_HOURS = 24;
const WINDOW_AFTER_DEADLINE_HOURS = 48;
const LATE_WINDOW_HOURS = 24;

function utcLabel(d: Date): string {
  return `${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

/** The sentence to append for a request for changes made at `now`, or null when none applies. */
export function resubmitNotice(now: Date, deadline: Date): string | null {
  const nowMs = now.getTime();
  const deadlineMs = deadline.getTime();
  if (nowMs > deadlineMs) {
    const until = new Date(nowMs + LATE_WINDOW_HOURS * HOUR_MS);
    return `Submissions have closed, so you have ${LATE_WINDOW_HOURS} hours to resubmit (until ${utcLabel(until)}). It is your one and only chance: if the project still doesn't meet the standards after that, it will be permanently rejected.`;
  }
  if (nowMs >= deadlineMs - ELIGIBLE_HOURS * HOUR_MS) {
    const until = new Date(deadlineMs + WINDOW_AFTER_DEADLINE_HOURS * HOUR_MS);
    return `Since this was requested in the last ${ELIGIBLE_HOURS} hours before the deadline, you have ${WINDOW_AFTER_DEADLINE_HOURS} hours after the deadline to resubmit (until ${utcLabel(until)}). After the deadline it is your one and only chance: if the project still doesn't meet the standards, it will be permanently rejected.`;
  }
  return null;
}
