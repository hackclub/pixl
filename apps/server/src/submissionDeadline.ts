import { submissionDeadline } from "./config.generated.js";

const HOUR_MS = 3_600_000;

/** Changes requested this long before the deadline (or later, up to it) earn a resubmit. */
export const RESUBMIT_ELIGIBLE_HOURS = 24;
/** Changes requested in that last day: the resubmit window closes this long after the deadline. */
export const RESUBMIT_WINDOW_HOURS = 48;
/** Changes requested after the deadline: the resubmit window closes this long after the request. */
export const LATE_RESUBMIT_WINDOW_HOURS = 24;

type ShipState = {
  status?: unknown;
  rejected_at?: unknown;
  first_shipped_at?: unknown;
  shipped_at?: unknown;
};

/**
 * Whether a ship attempt is refused because submissions have closed.
 *
 * After the deadline the only allowed ship is the single resubmit that a
 * "changes requested" earns, in two tiers (`changesRequestedAt` is the newest
 * needs_changes review_audits row):
 * - requested in the 24h before the deadline: resubmit until deadline + 48h;
 * - requested after the deadline: resubmit within 24h of the request;
 * - requested earlier than 24h before the deadline: refused (there was time to
 *   resubmit before the deadline).
 * The project must be in needs_changes, must have been submitted before the
 * deadline, and must not already have been shipped since (shipped_at restarts
 * on every ship, so a post-deadline shipped_at means the one chance is spent).
 * First submissions, drafts, rejected projects and updates to approved projects
 * are all refused.
 */
export function submissionsClosedFor(
  project: ShipState,
  now: Date = new Date(),
  deadline: Date = submissionDeadline,
  changesRequestedAt: Date | string | null = null,
): boolean {
  if (now <= deadline) return false;
  if (project.status !== "needs_changes" || project.rejected_at) return true;
  if (!project.first_shipped_at) return true;
  if (!changesRequestedAt) return true;
  const requested = new Date(changesRequestedAt).getTime();
  const deadlineMs = deadline.getTime();
  if (!Number.isFinite(requested) || requested < deadlineMs - RESUBMIT_ELIGIBLE_HOURS * HOUR_MS) return true;
  const windowEnd =
    requested <= deadlineMs
      ? deadlineMs + RESUBMIT_WINDOW_HOURS * HOUR_MS
      : requested + LATE_RESUBMIT_WINDOW_HOURS * HOUR_MS;
  if (now.getTime() > windowEnd) return true;
  const lastShip = project.shipped_at ? new Date(String(project.shipped_at)) : null;
  return !!lastShip && lastShip > deadline;
}
