// Client for api.stardancestats.xyz — an unofficial, public, no-auth JSON API
// that crawls stardance.hackclub.com's public pages. Used to import in-progress
// (not-yet-shipped) Stardance projects into Pixl as drafts, devlog history
// included. See apps/server/src/ysws/archive.ts for the sibling ships.hackclub.com
// importer this mirrors the shape of.
const API_BASE = "https://api.stardancestats.xyz/v1";
const CACHE_MS = 5 * 60_000;

export interface StardanceProject {
  id: string;
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

// Kept short because this runs synchronously in the request/response cycle
// of an interactive page load — a slow third-party API here shouldn't make
// the player wait anywhere near as long as a background job could tolerate.
const FETCH_TIMEOUT_MS = 6000;

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error("[stardance] fetch failed", url, e);
    return null;
  }
}

async function getSlackIdFromStardance(username: string): Promise<string | null> {
  try {
    const r = await fetch(`https://stardance.hackclub.com/@${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/cachet\.dunkirk\.sh\/users\/(U[A-Z0-9]+)/);
    return m ? m[1] : null;
  } catch (e) {
    console.error("[stardance] fallback profile fetch failed", username, e);
    return null;
  }
}

async function scrapeStardanceProjects(username: string): Promise<StardanceProject[]> {
  try {
    const r = await fetch(`https://stardance.hackclub.com/@${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!r.ok) return [];
    const html = await r.text();
    const projectRegex = /href="\/projects\/(\d+)"[^>]*>(.*?)<\/a>/g;
    const scraped: StardanceProject[] = [];
    let match;
    while ((match = projectRegex.exec(html)) !== null) {
      const id = match[1];
      const title = match[2].replace(/<[^>]*>/g, "").trim() || "Untitled project";
      scraped.push({
        id,
        title,
        description: "",
        repoUrl: "",
        demoUrl: "",
        bannerUrl: "https://stardance.hackclub.com/assets/profile/default-banner-4827579f.png"
      });
    }

    await Promise.all(
      scraped.map(async (p) => {
        try {
          const detailRes = await fetch(`https://stardance.hackclub.com/projects/${p.id}`, {
            signal: AbortSignal.timeout(5000),
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          if (!detailRes.ok) return;
          const detailHtml = await detailRes.text();
          
          const descMatch = detailHtml.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || 
                            detailHtml.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
          if (descMatch) p.description = descMatch[1].slice(0, 2000);
          
          const imageMatch = detailHtml.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
          if (imageMatch) p.bannerUrl = imageMatch[1];
          
          const githubMatch = detailHtml.match(/href="(https:\/\/github\.com\/[^"]+)"/i);
          if (githubMatch) p.repoUrl = githubMatch[1];
          
          const demoMatch = detailHtml.match(/href="((?!https:\/\/github\.com)(?!https:\/\/stardance\.hackclub\.com)https:\/\/[^"]+)"/i);
          if (demoMatch) p.demoUrl = demoMatch[1];
        } catch (err) {
          console.error("[stardance] project detail scrape failed", p.id, err);
        }
      })
    );
    
    return scraped;
  } catch (e) {
    console.error("[stardance] profile projects scrape failed", username, e);
    return [];
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

  let search = await fetchJson(
    `${API_BASE}/users/search?q=${encodeURIComponent(displayName)}&limit=5`,
  );
  // A failed fetch (fetchJson returns null on any non-2xx/timeout/parse
  // error) is not the same as a confirmed "no match" — but we can still fallback.
  const items: any[] = search && Array.isArray(search?.items) ? search.items : [];
  const usernamesSet = new Set<string>(items.map((item) => cleanField(item?.username)).filter(Boolean));

  // If the search returned no candidates, generate common handle candidates from the display name
  if (usernamesSet.size === 0) {
    const clean = displayName.trim().toLowerCase();
    if (clean) {
      usernamesSet.add(clean);
      usernamesSet.add(clean.replace(/\s+/g, ""));
      usernamesSet.add(clean.replace(/\s+/g, "-"));
      usernamesSet.add(clean.replace(/\s+/g, "_"));
    }
  }

  const usernames = Array.from(usernamesSet);

  // Confirm every candidate in parallel, not one at a time — sequential
  // fetches here stacked up to 5x FETCH_TIMEOUT_MS in the worst case, which
  // was slow enough to make the whole projects page look stuck.
  const profiles = await Promise.all(
    usernames.map(async (username) => {
      const apiProfile = await fetchJson(`${API_BASE}/users/${encodeURIComponent(username)}`);
      let sId = cleanField(apiProfile?.slack_id);
      if (!sId) {
        sId = await getSlackIdFromStardance(username) || "";
      }
      return { username, slackId: sId };
    }),
  );
  const matchIndex = profiles.findIndex((p) => p.slackId === slackId);
  const found = matchIndex === -1 ? null : usernames[matchIndex];
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
  const items: any[] = data && Array.isArray(data?.items) ? data.items : [];
  const apiItems = items.map((p) => ({
    id: cleanField(p._id),
    title: cleanField(p.title).slice(0, 120) || "Untitled project",
    description: cleanField(p.description).slice(0, 2000),
    repoUrl: safeUrl(p.repo_url),
    demoUrl: safeUrl(p.demo_url),
    bannerUrl: safeUrl(p.banner_url),
  }));

  const scrapedItems = await scrapeStardanceProjects(username);
  const combined = [...apiItems];
  for (const s of scrapedItems) {
    if (!combined.some((c) => c.id === s.id)) {
      combined.push(s);
    }
  }

  projectsCache.set(username, { at: Date.now(), value: combined });
  return combined;
}

const MAX_DEVLOG_PAGES = 10;
const DEVLOG_PAGE_SIZE = 50;

export async function stardanceDevlogsForProject(projectId: string): Promise<StardanceDevlog[]> {
  const out: StardanceDevlog[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_DEVLOG_PAGES; page++) {
    const data = await fetchJson(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/devlogs?limit=${DEVLOG_PAGE_SIZE}&offset=${offset}`,
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
    // A short page is the reliable end-of-stream signal — a page smaller
    // than what we asked for means there's nothing left. `total` (when
    // present) is just an early-exit optimization on top of that; trusting
    // it alone truncates silently if this unofficial API ever omits it.
    if (items.length < DEVLOG_PAGE_SIZE) break;
    const total = Number(data?.total);
    if (Number.isFinite(total) && offset >= total) break;
  }
  return out.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0));
}
