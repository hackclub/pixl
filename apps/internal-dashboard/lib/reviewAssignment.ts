// Reviewer assignment + the open window of the first-pass queue. Pure rules (no
// Next, no DB) so they are unit-testable; app/actions.ts, lib/db.ts and the
// queue page feed them project rows.
//
// The model:
// - The reviewer who first requests changes on a first-pass project is assigned
//   to it. From then on only they (and owners) can review it, and they are the
//   ones who approve it when the maker re-ships.
// - Their first "request changes" pays 1 pixel, held back until they approve.
//   Later requests for changes on the same project pay nothing.
// - The clock starts when the maker re-ships: the assignee has 3 days to review
//   it. After that the project goes back to the common queue and the held
//   pixel is forfeited.
// - A plain reviewer sees the whole queue but can only open the first page of
//   it (owners are exempt), so nobody cherry-picks from the end.

export const ASSIGNMENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** The assignee gets a DM this long after the maker re-ships. */
export const ASSIGNMENT_REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
/** Rows per queue page, and so how many projects a plain reviewer can open. */
export const QUEUE_OPEN_COUNT = 15;

export interface AssignmentFields {
  status?: string | null;
  assigned_reviewer_slack_id?: string | null;
  assigned_at?: string | null;
  assignment_reminded_at?: string | null;
  shipped_at?: string | null;
}

export function assigneeOf(p: AssignmentFields): string {
  return (p.assigned_reviewer_slack_id ?? "").trim();
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// When the assignee's 3 days begin: the maker's re-ship (shipped_at moves past
// assigned_at when they ship again), or the assignment itself for a project
// that is back in the queue without a re-ship. Null while the project isn't a
// first-pass one or has nobody assigned.
export function assignmentClockStartMs(p: AssignmentFields): number | null {
  if (!assigneeOf(p) || p.status !== "shipped") return null;
  const assigned = ms(p.assigned_at);
  const shipped = ms(p.shipped_at);
  if (shipped !== null && (assigned === null || shipped > assigned)) return shipped;
  return assigned;
}

export function assignmentDeadlineMs(p: AssignmentFields): number | null {
  const start = assignmentClockStartMs(p);
  return start === null ? null : start + ASSIGNMENT_WINDOW_MS;
}

export function isAssignmentOverdue(p: AssignmentFields, nowMs: number): boolean {
  const deadline = assignmentDeadlineMs(p);
  return deadline !== null && nowMs >= deadline;
}

// Due a reminder: a day into the window, still not overdue, and not reminded
// since this window began.
export function needsAssignmentReminder(p: AssignmentFields, nowMs: number): boolean {
  const start = assignmentClockStartMs(p);
  if (start === null || isAssignmentOverdue(p, nowMs)) return false;
  if (nowMs < start + ASSIGNMENT_REMIND_AFTER_MS) return false;
  const reminded = ms(p.assignment_reminded_at);
  return reminded === null || reminded < start;
}

// True when this project is reserved for someone else: assigned to another
// reviewer and still inside their window. Owners are never locked out.
export function lockedForViewer(
  p: AssignmentFields,
  viewerSlackId: string,
  isOwner: boolean,
  nowMs: number,
): boolean {
  const assignee = assigneeOf(p);
  if (!assignee || p.status !== "shipped" || isOwner) return false;
  if (isAssignmentOverdue(p, nowMs)) return false;
  return assignee !== viewerSlackId;
}

export interface QueueRowLike extends AssignmentFields {
  id: number | string;
  hold_at?: string | null;
  own?: boolean;
  claimedBy?: string | null;
}

// The ids a viewer may open. `rows` must be in the queue's own order (longest
// wait first), never a viewer-chosen sort, or changing the sort would change
// what is open. Owners can open everything. A plain reviewer gets the first
// `count` projects they could actually review (a row held, their own, being
// reviewed by someone else or reserved for another reviewer doesn't take a
// slot), plus anything assigned to them, wherever it sits.
export function openableQueueIds(
  rows: readonly QueueRowLike[],
  viewerSlackId: string,
  isOwner: boolean,
  nowMs: number,
  count: number = QUEUE_OPEN_COUNT,
): Set<number> {
  if (isOwner) return new Set(rows.map((r) => Number(r.id)));
  const open = new Set<number>();
  let free = 0;
  for (const r of rows) {
    if (assigneeOf(r) === viewerSlackId && !isAssignmentOverdue(r, nowMs)) {
      open.add(Number(r.id));
      continue;
    }
    if (r.hold_at || r.own || r.claimedBy || lockedForViewer(r, viewerSlackId, isOwner, nowMs)) continue;
    if (free < count) {
      open.add(Number(r.id));
      free++;
    }
  }
  return open;
}

// Why a queue row can't be opened, for the table to grey it out and say so.
// Plain data: it crosses from the server page to the client table.
export type QueueLock =
  | { reason: "assigned"; assignee: string | null; until: string | null }
  | { reason: "page" };

export interface PayoutRowLike {
  verdict?: string | null;
  status?: string | null;
}

// The held pixel goes only to the first request for changes: none when the
// project already has one that wasn't forfeited. After a forfeit the next
// reviewer to request changes starts a fresh assignment and earns it.
export function earnsChangesHold(existing: readonly PayoutRowLike[]): boolean {
  return !existing.some((r) => r.verdict === "needs_changes" && r.status !== "voided");
}
