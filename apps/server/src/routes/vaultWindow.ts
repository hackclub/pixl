export interface ChapterLevel {
  position: number;
  level: number;
  unlocked_at: string | null;
}

function comesBefore(a: ChapterLevel, b: ChapterLevel): boolean {
  const ap = Number(a.position);
  const bp = Number(b.position);
  return ap < bp || (ap === bp && Number(a.level) < Number(b.level));
}

export function chapterWindowStart(all: ChapterLevel[], target: ChapterLevel): Date | null {
  let latest: number | null = null;
  for (const l of all) {
    if (!l.unlocked_at || !comesBefore(l, target)) continue;
    const at = new Date(l.unlocked_at).getTime();
    if (latest === null || at > latest) latest = at;
  }
  return latest === null ? null : new Date(latest);
}
