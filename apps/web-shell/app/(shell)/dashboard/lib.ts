export interface Project {
  name: string;
  status: string;
  is_owner?: boolean;
  sidequest_id?: number | string;
  hackatime_projects?: string[];
}

export interface Trial {
  id: number | string;
  name: string;
  unlocked: boolean;
  completed: boolean;
  min_hours?: number | null;
}

export interface HackatimeProjectStat {
  name: string;
  seconds: number;
  secondsSinceCutoff?: number;
}

export interface HackatimeStats {
  connected: boolean;
  projects: HackatimeProjectStat[];
}

export interface NextStep {
  h: string;
  s: string;
  href: string;
  b: string;
}

// The first match wins, so this reads top-down as "the most useful thing
// right now."
export function nextStep(projects: Project[]): NextStep {
  const has = (s: string) => projects.find((p) => p.status === s);
  const needsWork = has("needs_changes");
  if (needsWork)
    return {
      h: `Fix up ${needsWork.name}`,
      s: "A reviewer sent this one back. Sort what they flagged and ship it again.",
      href: "/projects/",
      b: "OPEN",
    };
  const draft = has("draft");
  if (draft)
    return {
      h: `Ship ${draft.name}`,
      s: "It's still a draft. When it's finished and tracked, send it for review.",
      href: "/projects/",
      b: "OPEN",
    };
  if (has("shipped"))
    return {
      h: "You're in the review queue",
      s: "Nothing to do but wait. Start the next one while you're here.",
      href: "/projects/",
      b: "NEW PROJECT",
    };
  if (projects.length === 0)
    return {
      h: "Start your first project",
      s: "Pick something small and real. The docs walk through the whole thing.",
      href: "/docs/first-project/",
      b: "READ",
    };
  return {
    h: "Start your next project",
    s: "Everything's approved. Pick up a trial or build something of your own.",
    href: "/projects/",
    b: "NEW PROJECT",
  };
}

export function linkedSeconds(p: Project, stats: HackatimeStats | null): number {
  if (!stats?.connected) return 0;
  const linked = new Set(p.hackatime_projects ?? []);
  return stats.projects
    .filter((h) => linked.has(h.name))
    .reduce((s, h) => s + (h.secondsSinceCutoff ?? h.seconds), 0);
}

export function shippedSeconds(projects: Project[], stats: HackatimeStats | null): number {
  return projects
    .filter((p) => p.status && p.status !== "draft")
    .reduce((s, p) => s + linkedSeconds(p, stats), 0);
}

// The Trial the hours bar measures against: the one with a project on it,
// otherwise whichever Trial the player took on first.
export function barTrial(trials: Trial[], projects: Project[]): Trial | null {
  return (
    trials.find((t) => projects.some((p) => Number(p.sidequest_id) === Number(t.id))) ?? trials[0] ?? null
  );
}

export function formatHours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

interface LevelBand {
  throughLevel: number;
  rePerLevel: number;
}

// Segmented level-progress bar: fills relative to the CURRENT band, not to
// level 100, so it moves visibly on every ship instead of creeping a pixel
// at a time. One boolean per cell (20 cells, true = filled).
export function levelBarCells(bands: readonly LevelBand[], re: number, level: number, nextAt: number): boolean[] {
  const band = bands.find((b) => level < b.throughLevel) ?? bands[bands.length - 1]!;
  const prevAt = Math.max(0, nextAt - band.rePerLevel);
  const span = Math.max(1, nextAt - prevAt);
  const pct = Math.max(0, Math.min(1, (re - prevAt) / span));
  const cells = 20;
  const on = Math.round(pct * cells);
  return Array.from({ length: cells }, (_, i) => i < on);
}
