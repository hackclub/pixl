const ARCHIVE_URL = "https://ships.hackclub.com/api/v1/ysws_entries";
const CACHE_MS = 10 * 60_000;

export interface ArchiveEntry {
  ysws: string;
  hours: number;
  approvedAt: number | null;
  // Whoever the archive credits this entry to. A team's prior submission can
  // have one archive row per person (same code_url/demo_url, different
  // slack_id + hours each) - this is what lets buildDoubleDip attribute each
  // current collaborator's own prior credit instead of one lumped total.
  slackId: string;
}

export interface ArchiveShip extends ArchiveEntry {
  id: string;
  slackId: string;
  codeUrl: string;
  demoUrl: string;
  description: string;
  screenshotUrl: string;
}

export interface ArchiveMatch extends ArchiveEntry {
  url: string;
}

interface LoadedArchive {
  // All archive entries sharing that code_url/demo_url, one per credited
  // person - a team's prior submission has one row per collaborator.
  byUrl: Map<string, ArchiveEntry[]>;
  ships: ArchiveShip[];
}

let cache: { at: number; data: LoadedArchive } | null = null;

export function normalizeProjectUrl(raw: string): string {
  let s = String(raw ?? "").trim().toLowerCase();
  if (s === "" || s === "null" || s === "undefined") return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return s;
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

function toEntry(entry: Record<string, unknown>): ArchiveEntry {
  return {
    ysws: String(entry.ysws ?? "another YSWS"),
    hours: Number(entry.hours) || 0,
    approvedAt: Number(entry.approved_at) > 0 ? Number(entry.approved_at) : null,
    slackId: cleanField(entry.slack_id),
  };
}

async function loadArchive(): Promise<LoadedArchive | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  try {
    const r = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const json = (await r.json()) as any;
    const raw: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.entries)
        ? json.entries
        : Array.isArray(json?.data)
          ? json.data
          : [];

    const byUrl = new Map<string, ArchiveEntry[]>();
    const ships: ArchiveShip[] = [];
    for (const rawEntry of raw) {
      const entry = rawEntry as Record<string, unknown>;
      const info = toEntry(entry);
      for (const key of ["code_url", "demo_url"]) {
        const u = normalizeProjectUrl(String(entry[key] ?? ""));
        if (u === "") continue;
        const list = byUrl.get(u);
        if (list) list.push(info);
        else byUrl.set(u, [info]);
      }
      const id = cleanField(entry.id);
      if (id === "" || info.slackId === "") continue;
      ships.push({
        ...info,
        id,
        codeUrl: safeUrl(entry.code_url),
        demoUrl: safeUrl(entry.demo_url),
        description: cleanField(entry.description).slice(0, 2000),
        screenshotUrl: safeUrl(entry.screenshot_url),
      });
    }
    cache = { at: Date.now(), data: { byUrl, ships } };
    return cache.data;
  } catch (e) {
    console.error("[ysws-archive] fetch failed", e);
    return cache ? cache.data : null;
  }
}

// Every archive entry sharing this repo/demo URL - a team's prior submission
// has one row per collaborator (same URL, different slack_id + hours each),
// so buildDoubleDip can attribute each current collaborator's own prior
// credit instead of reporting one lumped total for "the player."
export async function findAllInYswsArchive(
  repoUrl: string,
  demoUrl: string,
): Promise<ArchiveMatch[]> {
  const loaded = await loadArchive();
  if (!loaded) return [];
  const { byUrl } = loaded;
  const repo = normalizeProjectUrl(repoUrl);
  const repoEntries = repo !== "" ? byUrl.get(repo) : undefined;
  if (repoEntries?.length) return repoEntries.map((e) => ({ url: repoUrl, ...e }));
  const demo = normalizeProjectUrl(demoUrl);
  const demoEntries = demo !== "" ? byUrl.get(demo) : undefined;
  if (demoEntries?.length) return demoEntries.map((e) => ({ url: demoUrl, ...e }));
  return [];
}

export async function findInYswsArchive(
  repoUrl: string,
  demoUrl: string,
): Promise<ArchiveMatch | null> {
  const all = await findAllInYswsArchive(repoUrl, demoUrl);
  if (!all.length) return null;
  // The highest-hours entry is the most representative single figure for
  // callers that only want one match (kept for backward compat).
  return all.reduce((best, e) => (e.hours > best.hours ? e : best));
}

export async function yswsShipsForSlackId(slackId: string): Promise<ArchiveShip[]> {
  const id = cleanField(slackId);
  if (id === "") return [];
  const loaded = await loadArchive();
  if (!loaded) return [];
  return loaded.ships
    .filter((s) => s.slackId === id)
    .sort((a, b) => (b.approvedAt ?? 0) - (a.approvedAt ?? 0));
}

export async function yswsShipForSlackId(
  slackId: string,
  entryId: string,
): Promise<ArchiveShip | null> {
  const ships = await yswsShipsForSlackId(slackId);
  return ships.find((s) => s.id === entryId) ?? null;
}