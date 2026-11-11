// Sorting and totals for the Audit notes tab's "one reviewer" view. Pure so
// the page stays a thin server component and the rules are unit tested.
import type { ReviewAuditRow } from "@/lib/db";

export const AUDIT_SORT_KEYS = ["date", "hours", "claimed", "time", "project", "verdict"] as const;
export type AuditSortKey = (typeof AUDIT_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export function parseAuditSort(raw: string | undefined): AuditSortKey {
  return (AUDIT_SORT_KEYS as readonly string[]).includes(raw ?? "") ? (raw as AuditSortKey) : "date";
}

export function parseSortDir(raw: string | undefined): SortDir {
  return raw === "asc" ? "asc" : "desc";
}

type SortRow = Pick<
  ReviewAuditRow,
  "created_at" | "approved_hours" | "claimed_hours" | "total_seconds" | "project_name" | "verdict"
>;

/** Rows with no value for the sort key (e.g. no approved hours) always go last, in either direction. */
export function sortAudits<T extends SortRow>(rows: T[], key: AuditSortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (a: T): number | string | null => {
    switch (key) {
      case "date":
        return new Date(a.created_at).getTime();
      case "hours":
        return a.approved_hours == null ? null : Number(a.approved_hours);
      case "claimed":
        return Number(a.claimed_hours);
      case "time":
        return Number(a.total_seconds);
      case "project":
        return (a.project_name ?? "").toLowerCase();
      case "verdict":
        return a.verdict;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va < vb) return -1 * sign;
    if (va > vb) return 1 * sign;
    return 0;
  });
}

export interface ReviewerSummary {
  reviews: number;
  approvedHours: number;
  claimedHours: number;
  byVerdict: Record<string, number>;
}

export function summarizeAudits(rows: SortRow[]): ReviewerSummary {
  const byVerdict: Record<string, number> = {};
  let approvedHours = 0;
  let claimedHours = 0;
  for (const a of rows) {
    byVerdict[a.verdict] = (byVerdict[a.verdict] ?? 0) + 1;
    approvedHours += a.approved_hours == null ? 0 : Number(a.approved_hours);
    claimedHours += Number(a.claimed_hours) || 0;
  }
  return { reviews: rows.length, approvedHours, claimedHours, byVerdict };
}
