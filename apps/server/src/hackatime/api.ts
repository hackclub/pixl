import { hackatimeCutoffUnix } from "../config.generated.js";

// Thin client for the HackTime API. We only need the authenticated project
// list (used to show "connected" + per-project time and to offer projects to
// link). Base URL is overridable via env for staging.
const BASE = (process.env.HACKATIME_BASE ?? "https://hackatime.hackclub.com").replace(/\/$/, "");
const PROJECTS_PATH = "/api/v1/authenticated/projects";

export interface HackatimeProject {
  name: string;
  seconds: number;
  // Set by /api/hackatime/stats (not fetchHackatimeStats itself) once it's
  // checked the project's activity against HACKATIME_CUTOFF.
  beforeCutoff?: boolean;
  secondsSinceCutoff?: number;
}

export interface HackatimeStats {
  connected: boolean;
  projects: HackatimeProject[];
  totalSeconds: number;
  error?: string;
}

const DISCONNECTED: HackatimeStats = { connected: false, projects: [], totalSeconds: 0 };

// Hours logged before this date predate the challenge and don't count toward
// ship eligibility, even for Hackatime projects/accounts that existed long
// before someone joined Pixl. Until this date passes, *everyone* reads as 0h
// countable and nothing can be shipped, that's intended, but it means the
// client copy has to explain it (see htBlockerText in web/projects/index.html,
// which mirrors this date; change both together).
export const HACKATIME_CUTOFF = hackatimeCutoffUnix;

interface HackatimeSpan {
  start: number;
  end: number;
}

async function fetchProjectSpans(
  slackId: string,
  token: string | null,
  projectName: string,
): Promise<HackatimeSpan[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url =
    `${BASE}/api/v1/users/${encodeURIComponent(slackId)}/heartbeats/spans` +
    `?filter_by_project=${encodeURIComponent(projectName)}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      spans?: { start_time?: number; end_time?: number }[];
    };
    return (json.spans ?? [])
      .map((s) => ({ start: Number(s.start_time) || 0, end: Number(s.end_time) || 0 }))
      .filter((s) => s.end > s.start);
  } catch (e) {
    console.error("[hackatime] spans fetch failed:", (e as Error)?.message ?? e);
    return [];
  }
}

function secondsSince(spans: HackatimeSpan[], sinceUnix: number): number {
  let sum = 0;
  for (const s of spans) {
    if (s.end <= sinceUnix) continue;
    sum += s.end - Math.max(s.start, sinceUnix);
  }
  return Math.max(0, Math.round(sum));
}

// Sum of tracked seconds across the given project names, clipped to only the
// portion after `sinceUnix` (defaults to the event cutoff). Requires the
// player's Hackatime-linked Slack id since heartbeat spans aren't exposed on
// the token-only "authenticated" alias used by fetchHackatimeStats.
export async function fetchTrackedSecondsSince(
  slackId: string | null,
  token: string | null,
  projectNames: string[],
  sinceUnix: number = HACKATIME_CUTOFF,
): Promise<number> {
  if (!slackId || projectNames.length === 0) return 0;
  const totals = await Promise.all(
    projectNames.map(async (name) =>
      secondsSince(await fetchProjectSpans(slackId, token, name), sinceUnix),
    ),
  );
  return totals.reduce((sum, s) => sum + s, 0);
}

export interface HackatimeActivitySummary {
  firstActivity: number | null;
  secondsSinceCutoff: number;
}

// One spans fetch, two answers: whether a project has activity from before
// the event cutoff (so the picker can warn about it) and how many seconds
// would actually count if linked (so the ship-readiness checklist doesn't
// promise more than the server will credit).
export async function fetchProjectActivitySummary(
  slackId: string | null,
  token: string | null,
  projectName: string,
  sinceUnix: number = HACKATIME_CUTOFF,
): Promise<HackatimeActivitySummary> {
  if (!slackId) return { firstActivity: null, secondsSinceCutoff: 0 };
  const spans = await fetchProjectSpans(slackId, token, projectName);
  if (spans.length === 0) return { firstActivity: null, secondsSinceCutoff: 0 };
  return {
    firstActivity: Math.min(...spans.map((s) => s.start)),
    secondsSinceCutoff: secondsSince(spans, sinceUnix),
  };
}

export async function fetchHackatimeStats(token: string | null): Promise<HackatimeStats> {
  if (!token) return DISCONNECTED;
  try {
    const res = await fetch(BASE + PROJECTS_PATH, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401) return { ...DISCONNECTED, error: "invalid_key" };
    if (!res.ok) return { ...DISCONNECTED, error: `http_${res.status}` };

    const body = (await res.json()) as {
      projects?: unknown[];
      data?: { projects?: unknown[] };
    };
    const raw = body.projects ?? body.data?.projects ?? [];
    const projects: HackatimeProject[] = raw
      .map((p) => {
        const o = p as { name?: unknown; total_seconds?: unknown; seconds?: unknown };
        return {
          name: String(o.name ?? ""),
          seconds: Number(o.total_seconds ?? o.seconds ?? 0),
        };
      })
      .filter((p) => p.name.length > 0);
    const totalSeconds = projects.reduce((sum, p) => sum + p.seconds, 0);
    return { connected: true, projects, totalSeconds };
  } catch (e) {
    console.error("[hackatime] fetch failed:", (e as Error)?.message ?? e);
    return { ...DISCONNECTED, error: "fetch_failed" };
  }
}
