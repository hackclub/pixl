export interface ChapterLevel {
  unlocked_at: string | null;
}

export function chapterWindowStart(all: ChapterLevel[], target: ChapterLevel): Date | null {
  let latest: number | null = null;
  for (const l of all) {
    if (l === target || !l.unlocked_at) continue;
    const at = new Date(l.unlocked_at).getTime();
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : new Date(latest);
}
