const ARCHIVE_URL = "https://ships.hackclub.com/api/v1/ysws_entries";
// The archive is ~7.5MB and takes the better part of ten seconds to serve, so
// a review page must never be the thing waiting on it. Past FRESH_MS the
// cached copy is still served, with the refetch kicked off behind it.
const FRESH_MS = 10 * 60_000;
// A failing archive used to mean every single review page paid the full
// timeout again. Back off instead.
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 25_000;

export interface YswsShip {
  ysws: string;
  approvedAt: string | null;
  hours: number;
  codeUrl: string;
  demoUrl: string;
  description: string;
  urlMatch: boolean;
}

interface ArchiveEntry {
  ysws?: string;
  approved_at?: number;
  hours?: number;
  code_url?: string;
  demo_url?: string;
  description?: string;
}

// Indexed by normalized code_url AND demo_url, so a lookup is two Map hits
// rather than a scan of every entry in the archive. Only the fields below are
// kept - holding the raw response would pin megabytes of screenshot urls and
// full descriptions in memory for nothing.
let archive: { at: number; byUrl: Map<string, YswsShip[]> } | null = null;
let inFlight: Promise<void> | null = null;
let failedAt = 0;

function norm(raw: string): string {
  let s = String(raw ?? "").trim().toLowerCase();
  if (s === "" || s === "null") return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return s;
}

function index(entries: ArchiveEntry[]): Map<string, YswsShip[]> {
  const byUrl = new Map<string, YswsShip[]>();
  for (const e of entries) {
    const codeUrl = String(e.code_url ?? "").trim();
    const demoUrl = String(e.demo_url ?? "").trim();
    const keys = new Set([norm(codeUrl), norm(demoUrl)]);
    keys.delete("");
    if (keys.size === 0) continue;
    const ship: YswsShip = {
      ysws: String(e.ysws ?? "?"),
      approvedAt:
        typeof e.approved_at === "number" && e.approved_at > 0
          ? new Date(e.approved_at * 1000).toISOString()
          : null,
      hours: Number(e.hours) || 0,
      codeUrl,
      demoUrl,
      description: String(e.description ?? "").slice(0, 300),
      urlMatch: true,
    };
    for (const k of keys) {
      const bucket = byUrl.get(k);
      if (bucket) bucket.push(ship);
      else byUrl.set(k, [ship]);
    }
  }
  return byUrl;
}

function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  if (failedAt && Date.now() - failedAt < RETRY_MS) return Promise.resolve();
  inFlight = (async () => {
    try {
      const r = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const json = (await r.json()) as unknown;
      archive = { at: Date.now(), byUrl: index(Array.isArray(json) ? (json as ArchiveEntry[]) : []) };
      failedAt = 0;
    } catch (e) {
      failedAt = Date.now();
      console.error("ysws archive fetch failed", (e as Error).message);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function matches(repo: string, demo: string): YswsShip[] {
  if (!archive) return [];
  const hits = new Set<YswsShip>();
  for (const key of new Set([repo, demo])) {
    if (!key) continue;
    for (const ship of archive.byUrl.get(key) ?? []) hits.add(ship);
  }
  return [...hits].sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""));
}

export async function yswsShipsFor(
  _slackId: string | null | undefined,
  repoUrl: string | null,
  demoUrl: string | null,
): Promise<YswsShip[]> {
  const repo = norm(repoUrl ?? "");
  const demo = norm(demoUrl ?? "");
  if (!repo && !demo) return [];
  if (!archive) await refresh();
  else if (Date.now() - archive.at > FRESH_MS) void refresh();
  return matches(repo, demo);
}

export type ReviewArchiveLookup = {
  status: "ready" | "loading" | "unavailable";
  ships: YswsShip[];
};

export async function yswsShipsForReview(
  _slackId: string | null | undefined,
  repoUrl: string | null,
  demoUrl: string | null,
  maxWaitMs = 1500,
): Promise<ReviewArchiveLookup> {
  const repo = norm(repoUrl ?? "");
  const demo = norm(demoUrl ?? "");
  if (!repo && !demo) return { status: "ready", ships: [] };

  if (!archive) {
    const pending = refresh();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, Math.max(0, maxWaitMs));
      void pending.then(
        () => { clearTimeout(timeout); resolve(); },
        () => { clearTimeout(timeout); resolve(); },
      );
    });
  } else if (Date.now() - archive.at > FRESH_MS) {
    void refresh();
  }

  if (archive) return { status: "ready", ships: matches(repo, demo) };
  return { status: inFlight ? "loading" : "unavailable", ships: [] };
}

export function __resetArchiveForTests() {
  archive = null;
  inFlight = null;
  failedAt = 0;
}
