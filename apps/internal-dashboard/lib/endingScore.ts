// "Pixl ending score": the reviewer contest for the last stretch of the program.
// An approval is worth 3 points, a change request or a ban 1 point. Only
// verdicts logged between ENDING_SCORE_START and ENDING_SCORE_END count.
//
// The source is review_audits. A first-pass approval a final reviewer judged bad
// (removeFirstPassPayout) is rewritten to "first_pass_removed", which is not
// listed here, so it stops counting without any special case.

// The moment the 8 px approval rate went live and the contest started (UTC).
export const ENDING_SCORE_START = Date.UTC(2026, 10, 17, 17, 25, 0);
// Monday November 30th, 11:59 PM UTC, inclusive.
export const ENDING_SCORE_END = Date.UTC(2026, 11, 1, 0, 0, 0) - 1;

export const APPROVAL_POINTS = 3;
export const OTHER_POINTS = 1;

const APPROVALS = new Set(["approved", "first_pass_approved"]);
const OTHERS = new Set(["needs_changes", "banned", "first_pass_banned"]);

export interface ScoreAudit {
  reviewer: string;
  verdict: string;
  created_at: string;
}

export interface ScoreRow {
  /** Slack id when the label has one, else the label. One person, one row. */
  key: string;
  /** Most recent "Name (SLACKID)" label seen for them. */
  reviewer: string;
  approvals: number;
  others: number;
  points: number;
  rank: number;
}

export function pointsFor(verdict: string): number {
  if (APPROVALS.has(verdict)) return APPROVAL_POINTS;
  if (OTHERS.has(verdict)) return OTHER_POINTS;
  return 0;
}

export function inWindow(createdAt: string, start = ENDING_SCORE_START, end = ENDING_SCORE_END): boolean {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && t >= start && t <= end;
}

function keyOf(label: string): string {
  return /\(([^()]+)\)\s*$/.exec(label)?.[1] ?? label;
}

// `audits` is expected newest first, so the first label seen is the latest name.
// Ties share a rank (1, 2, 2, 4), ordered by approvals then name.
export function endingScores(
  audits: readonly ScoreAudit[],
  start = ENDING_SCORE_START,
  end = ENDING_SCORE_END,
): ScoreRow[] {
  const byKey = new Map<string, Omit<ScoreRow, "rank">>();
  for (const a of audits) {
    const pts = pointsFor(a.verdict);
    if (pts === 0 || !inWindow(a.created_at, start, end)) continue;
    const key = keyOf(a.reviewer);
    const row = byKey.get(key) ?? { key, reviewer: a.reviewer, approvals: 0, others: 0, points: 0 };
    if (APPROVALS.has(a.verdict)) row.approvals++;
    else row.others++;
    row.points += pts;
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort(
    (a, b) => b.points - a.points || b.approvals - a.approvals || a.reviewer.localeCompare(b.reviewer),
  );
  let prev: Omit<ScoreRow, "rank"> | null = null;
  let prevRank = 0;
  return rows.map((r, i) => {
    const rank = prev && prev.points === r.points && prev.approvals === r.approvals ? prevRank : i + 1;
    prev = r;
    prevRank = rank;
    return { ...r, rank };
  });
}
