import { submissionDeadline } from "./config.generated.js";

const HOUR_MS = 3_600_000;

/** Changes requested this long before the deadline (or later, up to it) earn a resubmit. */
export const RESUBMIT_ELIGIBLE_HOURS = 24;
/** The resubmit window closes this long after the deadline. */
export const RESUBMIT_WINDOW_HOURS = 48;

type ShipState = {
  status?: unknown;
  rejected_at?: unknown;
  first_shipped_at?: unknown;
  shipped_at?: unknown;
};

/**
 * Whether the post-deadline resubmit window is still open (deadline + 48h).
 * Callers use it to skip the changes-requested lookup once it can't matter.
 */
export function resubmitWindowOpen(now: Date = new Date(), deadline: Date = submissionDeadline): boolean {
  return now.getTime() <= deadline.getTime() + RESUBMIT_WINDOW_HOURS * HOUR_MS;
}

/**
 * Whether a ship attempt is refused because submissions have closed.
 *
 * After the deadline the only allowed ship is the single resubmit that a
 * "changes requested" in the last 24h before the deadline earns, and only for
 * 48h after the deadline. The project must be in needs_changes, must have been
 * submitted before the deadline, the changes must have been requested between
 * deadline-24h and the deadline (`changesRequestedAt`, the newest needs_changes
 * review_audits row), and it must not already have been shipped since
 * (shipped_at restarts on every ship, so a post-deadline shipped_at means the
 * one chance is spent). First submissions, drafts, rejected projects, updates
 * to approved projects and older change requests are all refused.
 */
export function submissionsClosedFor(
  project: ShipState,
  now: Date = new Date(),
  deadline: Date = submissionDeadline,
  changesRequestedAt: Date | string | null = null,
): boolean {
  if (now <= deadline) return false;
  if (!resubmitWindowOpen(now, deadline)) return true;
  if (project.status !== "needs_changes" || project.rejected_at) return true;
  if (!project.first_shipped_at) return true;
  if (!changesRequestedAt) return true;
  const requested = new Date(changesRequestedAt).getTime();
  if (!(requested >= deadline.getTime() - RESUBMIT_ELIGIBLE_HOURS * HOUR_MS && requested <= deadline.getTime())) return true;
  const lastShip = project.shipped_at ? new Date(String(project.shipped_at)) : null;
  return !!lastShip && lastShip > deadline;
}
