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

// getSlackIdFromStardance and scrapeStardanceProjects both need the same
// profile page for the same username — cached here so a request that needs
// both (slack_id confirm, then project listing) only fetches it once.
const profileHtmlCache = new Map<string, { at: number; html: string | null }>();

async function fetchProfileHtml(username: string): Promise<string | null> {
  const cached = profileHtmlCache.get(username);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.html;
  let html: string | null = null;
  try {
    const r = await fetch(`https://stardance.hackclub.com/@${encodeURIComponent(username)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (r.ok) html = await r.text();
  } catch (e) {
    console.error("[stardance] profile page fetch failed", username, e);
  }
  profileHtmlCache.set(username, { at: Date.now(), html });
  return html;
}

// Fallback for when the crawler API's own slack_id field comes back empty
// (the exact bug that broke matching for a real player earlier) — scrapes it
// straight off the account's live avatar instead.
async function getSlackIdFromStardance(username: string): Promise<string | null> {
  const html = await fetchProfileHtml(username);
  if (!html) return null;
  const m = html.match(/cachet\.dunkirk\.sh\/users\/(U[A-Z0-9]+)/);
  return m ? m[1] : null;
}

// Fallback for when the crawler API's project list comes back empty for a
// real account. Only ever called when the API gave us nothing to work with
// (see stardanceProjectsForUser) — this does a full profile fetch plus one
// fetch per scraped project, which is too slow to run unconditionally on
// every request.
async function scrapeStardanceProjects(username: string): Promise<StardanceProject[]> {
  const html = await fetchProfileHtml(username);
  if (!html) return [];
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
      // No fallback image here on purpose — Stardance's own default banner
      // is their branding, not a real project thumbnail, and we don't want
      // it showing up on an imported Pixl project.
      bannerUrl: "",
    });
  }

  await Promise.all(
    scraped.map(async (p) => {
      try {
        const detailRes = await fetch(`https://stardance.hackclub.com/projects/${p.id}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!detailRes.ok) return;
        const detailHtml = await detailRes.text();

        const descMatch =
          detailHtml.match(/<meta\s+name="description"\s+content="([^"]*)"/i) ||
          detailHtml.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
        if (descMatch) p.description = descMatch[1].slice(0, 2000);

        // Skip it if this is just Stardance's own default banner (their
        // og:image falls back to it when the project has no real screenshot)
        // — that's their branding, not this project's thumbnail.
        const imageMatch = detailHtml.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
        if (imageMatch && !imageMatch[1].includes("default-banner")) p.bannerUrl = imageMatch[1];

        // repoUrl is safe to scrape this way — it's constrained to github.com
        // so a false match is unlikely. demoUrl has no such constraint (it
        // could be any host), so "first external link that isn't github or
        // stardance" risked grabbing a share button, an embed, anything —
        // left blank instead; the player fills it in before shipping, same
        // as any other draft (parseProjectBody doesn't require it at save
        // time).
        const githubMatch = detailHtml.match(/href="(https:\/\/github\.com\/[^"]+)"/i);
        if (githubMatch) p.repoUrl = githubMatch[1];
      } catch (err) {
        console.error("[stardance] project detail scrape failed", p.id, err);
      }
    }),
  );

  return scraped;
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

  // Scraping is a fallback for when the API gives us nothing to work with
  // (a real failure mode we hit — a valid account with an empty items
  // array), not something to run on every request. Doing it unconditionally
  // meant every cache-miss paid for a full profile fetch plus one fetch per
  // project even when the API's own data was already complete — exactly the
  // kind of slow external round-trip that stalled the whole import box for
  // other players before.
  const combined = apiItems.length > 0 ? apiItems : await scrapeStardanceProjects(username);

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
