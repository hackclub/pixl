// The review queue's sort tabs, and the cookie that remembers the last one a
// reviewer picked so coming back from a review (or from the nav) doesn't reset
// it to Oldest. proxy.ts sets the cookie whenever /review is opened with a
// valid ?sort=; the queue page falls back to it when the URL has none.
export const REVIEW_SORTS = [
  { key: "oldest", label: "Oldest" },
  { key: "hours", label: "Hours" },
  { key: "status", label: "Status" },
] as const;

export type ReviewSort = (typeof REVIEW_SORTS)[number]["key"];

export const REVIEW_SORT_COOKIE = "pixl_review_sort";

export function isReviewSort(value: string | null | undefined): value is ReviewSort {
  return REVIEW_SORTS.some((s) => s.key === value);
}
