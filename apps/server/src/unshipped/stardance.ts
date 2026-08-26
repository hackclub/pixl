// Client for api.stardancestats.xyz — an unofficial, public, no-auth JSON API
// that crawls stardance.hackclub.com's public pages. Used to import in-progress
// (not-yet-shipped) Stardance projects into Pixl as drafts, devlog history
// included. See apps/server/src/ysws/archive.ts for the sibling ships.hackclub.com
// importer this mirrors the shape of.
const API_BASE = "https://api.stardancestats.xyz/v1";
const CACHE_MS = 5 * 60_000;

export interface StardanceProject {
  id: number;
  title: string;
  description: string;
  repoUrl: string;
  demoUrl: string;
  bannerUrl: string;
}

export interface StardanceDevlog {
  body: string;
  postedAt: string;
  images: string[];
}

function cleanField(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

function safeUrl(raw: unknown): string {
  const s = cleanField(raw);
  if (s === "") return "";
  try {
    const proto = new URL(s).protocol;
    return proto === "http:" || proto === "https:" ? s : "";
  } catch {
    return "";
  }
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error("[stardance] fetch failed", url, e);
    return null;
  }
}

const usernameCache = new Map<string, { at: number; value: string | null }>();

// Stardance has no lookup-by-slack_id endpoint, so we search by the player's
// Pixl display name, then confirm the right account by matching slack_id
// against what Pixl already has on file — the same identity signal the
// ships.hackclub.com import already relies on. Only an exact slack_id match
// auto-selects; anything else comes back empty.
export async function findStardanceUsername(
  displayName: string,
  slackId: string,
): Promise<string | null> {
  if (!displayName || !slackId) return null;
  const cached = usernameCache.get(slackId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const search = await fetchJson(
    `${API_BASE}/users/search?q=${encodeURIComponent(displayName)}&limit=5`,
  );
  const items: any[] = Array.isArray(search?.items) ? search.items : [];
  let found: string | null = null;
  for (const item of items) {
    const username = cleanField(item?.username);
    if (username === "") continue;
    const profile = await fetchJson(`${API_BASE}/users/${encodeURIComponent(username)}`);
    if (cleanField(profile?.slack_id) === slackId) {
      found = username;
      break;
    }
  }
  usernameCache.set(slackId, { at: Date.now(), value: found });
  return found;
}

const projectsCache = new Map<string, { at: number; value: StardanceProject[] }>();

export async function stardanceProjectsForUser(username: string): Promise<StardanceProject[]> {
  const cached = projectsCache.get(username);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const data = await fetchJson(
    `${API_BASE}/users/${encodeURIComponent(username)}/projects?limit=60`,
  );
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const projects = items.map((p) => ({
    id: Number(p._id),
    title: cleanField(p.title).slice(0, 120) || "Untitled project",
    description: cleanField(p.description).slice(0, 2000),
    repoUrl: safeUrl(p.repo_url),
    demoUrl: safeUrl(p.demo_url),
    bannerUrl: safeUrl(p.banner_url),
  }));
  projectsCache.set(username, { at: Date.now(), value: projects });
  return projects;
}

const MAX_DEVLOG_PAGES = 10;

export async function stardanceDevlogsForProject(projectId: number): Promise<StardanceDevlog[]> {
  const out: StardanceDevlog[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_DEVLOG_PAGES; page++) {
    const data = await fetchJson(
      `${API_BASE}/projects/${projectId}/devlogs?limit=50&offset=${offset}`,
    );
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) break;
    for (const d of items) {
      const body = cleanField(d.body);
      if (body === "") continue;
      const images = Array.isArray(d.media)
        ? (d.media as any[])
            .filter((m) => m?.kind === "image")
            .map((m) => safeUrl(m.url))
            .filter(Boolean)
        : [];
      out.push({ body, postedAt: cleanField(d.posted_at), images });
    }
    offset += items.length;
    if (offset >= (Number(data?.total) || 0)) break;
  }
  return out.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0));
}
