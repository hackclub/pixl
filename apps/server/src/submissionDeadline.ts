import { submissionDeadline } from "./config.generated.js";

type ShipState = {
  status?: unknown;
  rejected_at?: unknown;
  first_shipped_at?: unknown;
  shipped_at?: unknown;
};

/**
 * Whether a ship attempt is refused because submissions have closed.
 *
 * After the deadline the only allowed ship is the single resubmit a reviewer's
 * "changes requested" earns: the project must be in needs_changes, must have
 * been submitted before the deadline, and must not already have been shipped
 * since (shipped_at restarts on every ship, so a post-deadline shipped_at means
 * the one chance is spent). First submissions, drafts, rejected projects and
 * updates to approved projects are all refused.
 */
export function submissionsClosedFor(
  project: ShipState,
  now: Date = new Date(),
  deadline: Date = submissionDeadline,
): boolean {
  if (now <= deadline) return false;
  if (project.status !== "needs_changes" || project.rejected_at) return true;
  if (!project.first_shipped_at) return true;
  const lastShip = project.shipped_at ? new Date(String(project.shipped_at)) : null;
  return !!lastShip && lastShip > deadline;
}
