// Filter groups are derived from the maker's existing project_type.
// They don't change the hardware/software review queues or reviewer access.
export const REVIEW_TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "games", label: "Games" },
  { id: "web", label: "Web" },
  { id: "desktop", label: "Desktop" },
  { id: "python", label: "Python" },
  { id: "mobile", label: "Mobile" },
  { id: "hardware", label: "Hardware" },
  { id: "cad", label: "CAD" },
  { id: "other", label: "Other" },
] as const;

export type ReviewTypeFilter = (typeof REVIEW_TYPE_FILTERS)[number]["id"];

export function reviewTypeGroup(projectType: string | null | undefined, isGame = false): Exclude<ReviewTypeFilter, "all"> {
  if (isGame) return "games";
  switch (projectType) {
    case "web": return "web";
    case "windows":
    case "mac":
    case "linux":
    case "cross_platform": return "desktop";
    case "python": return "python";
    case "android":
    case "ios": return "mobile";
    case "hardware": return "hardware";
    case "cad": return "cad";
    default: return "other";
  }
}

export function parseReviewTypeFilter(input: string | undefined): ReviewTypeFilter {
  return REVIEW_TYPE_FILTERS.find((filter) => filter.id === input)?.id ?? "all";
}

// Caller must compute allowed review IDs against the complete oldest-first
// queue first. A filter must never unlock a project beyond that window.
export function filterReviewType<T extends { project_type?: string | null; is_game?: boolean | null }>(
  rows: readonly T[],
  selected: ReviewTypeFilter,
): T[] {
  if (selected === "all") return [...rows];
  return rows.filter((row) => reviewTypeGroup(row.project_type, row.is_game === true) === selected);
}
