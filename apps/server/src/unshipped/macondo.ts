// Client for macondo.hackclub.com's real public explore API — used to import
// in-progress (not-yet-shipped) Macondo projects into Pixl as drafts. Their
// public API has no devlog/journal data (only a leaky internal route does,
// which we deliberately don't use — see session notes). No per-owner filter
// param exists either, so the whole corpus is cached and filtered here by
// owner.slack_id, same shape as apps/server/src/ysws/archive.ts.
const API_BASE = "https://macondo.hackclub.com/api/explore/projects";
const CACHE_MS = 10 * 60_000;
const MAX_PAGES = 40;

export interface MacondoProject {
  id: number;
  name: string;
  description: string;
  thumbnailUrl: string;
  ownerSlackId: string;
}

function cleanField(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

let cache: { at: number; data: MacondoProject[] } | null = null;

async function loadAll(): Promise<MacondoProject[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const all: MacondoProject[] = [];
  let cursor = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await fetch(`${API_BASE}?cursor=${cursor}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const json = (await r.json()) as any;
      const items: any[] = Array.isArray(json?.items) ? json.items : [];
      if (items.length === 0) break;
      for (const p of items) {
        const slackId = cleanField(p?.owner?.slack_id);
        if (slackId === "") continue;
        all.push({
          id: Number(p.id),
          name: cleanField(p.name).slice(0, 120) || "Untitled project",
          description: cleanField(p.description).slice(0, 2000),
          thumbnailUrl: cleanField(p.thumbnail_url),
          ownerSlackId: slackId,
        });
      }
      const next = Number(json?.next_cursor);
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
    }
    cache = { at: Date.now(), data: all };
    return all;
  } catch (e) {
    console.error("[macondo] fetch failed", e);
    return cache ? cache.data : [];
  }
}

export async function macondoProjectsForSlackId(slackId: string): Promise<MacondoProject[]> {
  const id = cleanField(slackId);
  if (id === "") return [];
  const all = await loadAll();
  return all.filter((p) => p.ownerSlackId === id);
}
