// When a project's wait in the review queue started. Pure and import-free so
// both the server-side queue sort (lib/db.ts) and the client-side "waited"
// column (app/_components/ReviewTable.tsx) apply the exact same rule.
//
// - A first ship, or a fix-and-reship after changes were requested, counts the
//   whole time since the maker FIRST sent the project in (first_shipped_at):
//   shipped_at restarts on every reship, but the player has been waiting on a
//   verdict the whole time.
// - An update ship of an already approved project (is_update) is a brand new
//   submission: the old approval already got its verdict, so its wait starts
//   at this ship. Counting from the original ship would put every update at
//   the front of the queue ahead of projects that have been waiting for weeks.
export interface QueueWaitInput {
  first_shipped_at?: string | null;
  shipped_at?: string | null;
  is_update?: boolean | null;
}

export function queueWaitSince(p: QueueWaitInput): string | null {
  if (p.is_update) return p.shipped_at ?? p.first_shipped_at ?? null;
  return p.first_shipped_at ?? p.shipped_at ?? null;
}

/** queueWaitSince as epoch milliseconds, 0 when there is no date at all. */
export function queueWaitStartMs(p: QueueWaitInput): number {
  const iso = queueWaitSince(p);
  return iso ? new Date(iso).getTime() : 0;
}
