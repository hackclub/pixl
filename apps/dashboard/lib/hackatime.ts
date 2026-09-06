import type { Commit } from "@/lib/github";

const BASE = (process.env.HACKATIME_BASE ?? "https://hackatime.hackclub.com").replace(/\/$/, "");

export interface Span {
  start: number;
  end: number;
}

// Coding spans for a user's linked Hackatime projects, oldest first. Uses the
// player's stored OAuth token so private stats resolve too; falls back to the
// public endpoint. Null when Hackatime is unreachable or nothing is linked.
export async function fetchUserSpans(
  slackId: string | null | undefined,
  token: string | null,
  projects: string[],
): Promise<Span[] | null> {
  const id = (slackId ?? "").trim();
  if (!id || projects.length === 0) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url =
    `${BASE}/api/v1/users/${encodeURIComponent(id)}/heartbeats/spans` +
    `?filter_by_project=${encodeURIComponent(projects.join(","))}`;
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 300 },
    });
    if (!r.ok) return null;
    const json = (await r.json()) as {
      spans?: { start_time?: number; end_time?: number }[];
    };
    return (json.spans ?? [])
      .map((s) => ({ start: Number(s.start_time) || 0, end: Number(s.end_time) || 0 }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);
  } catch (e) {
    console.error("hackatime spans fetch failed", (e as Error).message);
    return null;
  }
}

function secondsSinceUnix(spans: Span[], sinceUnix: number): number {
  let sum = 0;
  for (const s of spans) {
    if (s.end <= sinceUnix) continue;
    sum += s.end - Math.max(s.start, sinceUnix);
  }
  return Math.max(0, Math.round(sum));
}

// Same math as apps/server's fetchTrackedSecondsSince, reimplemented here
// because the dashboard talks to Hackatime directly rather than through
// apps/server, used by the reviewer "extend hours cutoff" override so a
// legitimately-early-started project can count hours from before the global
// hackatimeCutoff (see extendHoursCutoff in app/actions.ts).
export async function fetchTrackedSecondsSince(
  slackId: string | null | undefined,
  token: string | null,
  projectNames: string[],
  sinceUnix: number,
): Promise<number | null> {
  const spans = await fetchUserSpans(slackId, token, projectNames);
  if (spans === null) return null;
  return secondsSinceUnix(spans, sinceUnix);
}

export interface TrustFactor {
  level: string;
  value: number;
}

// Hackatime's own fraud signal for a user (blue/green convicted/etc.).
export async function fetchTrustFactor(
  slackId: string | null | undefined,
): Promise<TrustFactor | null> {
  const id = (slackId ?? "").trim();
  if (!id) return null;
  try {
    const r = await fetch(
      `${BASE}/api/v1/users/${encodeURIComponent(id)}/trust_factor`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 600 } },
    );
    if (!r.ok) return null;
    const json = (await r.json()) as { trust_level?: string; trust_value?: number };
    if (!json.trust_level) return null;
    return { level: String(json.trust_level), value: Number(json.trust_value) || 0 };
  } catch {
    return null;
  }
}

export interface HackatimeBreakdown {
  name: string;
  seconds: number;
  text: string;
  percent: number;
  color?: string;
}

export interface LapseTimelapse {
  id: string;
  name: string;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  duration: number;
}

export interface HackatimeProjectReport {
  name: string;
  seconds: number;
  text: string;
  percent: number;
  linked: boolean;
  sessions: number;
  firstActivity: number | null;
  lastActivity: number | null;
  /** Lapse timelapse videos of this project's coding sessions, if any. */
  lapses: LapseTimelapse[];
}

const LAPSE_BASE = "https://api.lapse.hackclub.com";

// Lapse (a separate Hack Club service, not Hackatime itself) records timelapse
// videos of coding sessions. No API token needed - confirmed live, an
// unauthenticated request returns a normal {ok:true,...} body, not a 401.
// hackatimeUserId is the numeric Hackatime user id (Hackatime's own
// /stats response calls it data.user_id - see fetchHackatimeReport below),
// not the Slack id used everywhere else in this file.
export async function fetchLapsesForProject(
  hackatimeUserId: string,
  projectKey: string,
): Promise<LapseTimelapse[]> {
  if (!hackatimeUserId || !projectKey) return [];
  try {
    const r = await fetch(
      `${LAPSE_BASE}/api/hackatime/timelapsesForProject` +
        `?hackatimeUserId=${encodeURIComponent(hackatimeUserId)}&projectKey=${encodeURIComponent(projectKey)}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 300 } },
    );
    if (!r.ok) return [];
    const json = (await r.json()) as {
      ok?: boolean;
      data?: {
        timelapses?: {
          id?: string;
          name?: string;
          playbackUrl?: string | null;
          thumbnailUrl?: string | null;
          duration?: number;
        }[];
      };
    };
    if (!json.ok) return [];
    return (json.data?.timelapses ?? []).map((t) => ({
      id: String(t.id ?? ""),
      name: String(t.name ?? "Untitled lapse"),
      playbackUrl: t.playbackUrl ?? null,
      thumbnailUrl: t.thumbnailUrl ?? null,
      duration: Number(t.duration) || 0,
    }));
  } catch (e) {
    console.error("lapse fetch failed", (e as Error).message);
    return [];
  }
}

export interface HackatimeReport {
  ok: boolean;
  /** Hackatime's own numeric user id (data.user_id on its /stats response) -
   * NOT the Slack id this file otherwise keys everything off. Empty when
   * unavailable. */
  hackatimeUserId: string;
  totalSeconds: number;
  humanReadableTotal: string;
  dailyAverageSeconds: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  languages: HackatimeBreakdown[];
  languagesScoped: boolean;
  editors: HackatimeBreakdown[];
  operatingSystems: HackatimeBreakdown[];
  machines: HackatimeBreakdown[];
  projects: HackatimeProjectReport[];
}

function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function mapBreakdown(arr: unknown): HackatimeBreakdown[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => {
    const o = x as Record<string, unknown>;
    return {
      name: String(o.name ?? "?"),
      seconds: Number(o.total_seconds) || 0,
      text: String(o.text ?? fmtSeconds(Number(o.total_seconds) || 0)),
      percent: Number(o.percent) || 0,
      color: typeof o.color === "string" ? o.color : undefined,
    };
  });
}

// Everything Hackatime exposes for this maker, focused on the projects they
// linked to the submission: overall totals + language/editor/OS breakdowns, and
// per linked project the total time, share, coding-session count and first/last
// activity (from span data). Public endpoints; the token just unlocks private
// stats. Never throws into the page.
export async function fetchHackatimeReport(
  slackId: string | null | undefined,
  token: string | null,
  linkedProjects: string[],
): Promise<HackatimeReport> {
  const empty: HackatimeReport = {
    ok: false,
    hackatimeUserId: "",
    totalSeconds: 0,
    humanReadableTotal: "",
    dailyAverageSeconds: 0,
    rangeStart: null,
    rangeEnd: null,
    languages: [],
    languagesScoped: false,
    editors: [],
    operatingSystems: [],
    machines: [],
    projects: [],
  };
  const id = (slackId ?? "").trim();
  if (!id) return empty;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const linked = new Set(linkedProjects);

  try {
    const statsRes = await fetch(
      `${BASE}/api/v1/users/${encodeURIComponent(id)}/stats` +
        `?features=projects,languages,editors,operating_systems,machines`,
      { headers, signal: AbortSignal.timeout(10000), next: { revalidate: 300 } },
    );
    if (!statsRes.ok) return empty;
    const data = ((await statsRes.json()) as { data?: Record<string, unknown> }).data ?? {};

    const rawProjects = mapBreakdown(data.projects);
    // Every project name the panel will actually display below (line ~313's
    // filter) - not just the submission's explicitly linked projects. A
    // Hackatime project with real tracked time but not in `linked` still gets
    // shown (p.seconds > 0), so fetching spans/lapses only for `linked` left
    // those rows permanently missing their session count and any lapse
    // recordings, even when Lapse genuinely had some for that project name.
    const displayNames = new Set(
      rawProjects.filter((p) => linked.has(p.name) || p.seconds > 0).map((p) => p.name),
    );
    // Per-project sessions/first/last from spans, in parallel , a maker's
    // Hackatime account rarely has more than a handful of shown projects.
    const spanInfo = new Map<string, { sessions: number; first: number | null; last: number | null }>();
    // Lapse (timelapse videos) needs Hackatime's own numeric user id, not the
    // Slack id this file otherwise uses everywhere - present on the stats
    // response as data.user_id.
    const hackatimeUserId = data.user_id != null ? String(data.user_id) : "";
    const lapseInfo = new Map<string, LapseTimelapse[]>();
    await Promise.all(
      [...displayNames].map(async (name) => {
        try {
          const r = await fetch(
            `${BASE}/api/v1/users/${encodeURIComponent(id)}/heartbeats/spans` +
              `?filter_by_project=${encodeURIComponent(name)}`,
            { headers, signal: AbortSignal.timeout(8000), next: { revalidate: 300 } },
          );
          if (!r.ok) return;
          const spans = ((await r.json()) as { spans?: { start_time?: number; end_time?: number }[] }).spans ?? [];
          if (spans.length === 0) return;
          let first = Infinity;
          let last = 0;
          for (const s of spans) {
            first = Math.min(first, Number(s.start_time) || Infinity);
            last = Math.max(last, Number(s.end_time) || 0);
          }
          spanInfo.set(name, {
            sessions: spans.length,
            first: Number.isFinite(first) ? first : null,
            last: last > 0 ? last : null,
          });
        } catch {
          /* ignore per-project span failures */
        }
      }),
    );
    if (hackatimeUserId) {
      await Promise.all(
        [...displayNames].map(async (name) => {
          const lapses = await fetchLapsesForProject(hackatimeUserId, name);
          if (lapses.length > 0) lapseInfo.set(name, lapses);
        }),
      );
    }

    // Languages scoped to just this submission's linked projects , the
    // account-wide stats above mix in everything else the maker codes.
    let projectLanguages: HackatimeBreakdown[] = [];
    if (linked.size > 0) {
      try {
        const langRes = await fetch(
          `${BASE}/api/v1/users/${encodeURIComponent(id)}/stats` +
            `?features=languages&filter_by_project=${encodeURIComponent([...linked].join(","))}`,
          { headers, signal: AbortSignal.timeout(10000), next: { revalidate: 300 } },
        );
        if (langRes.ok) {
          const ld = ((await langRes.json()) as { data?: Record<string, unknown> }).data ?? {};
          projectLanguages = mapBreakdown(ld.languages);
        }
      } catch {
        /* fall back to account-wide languages */
      }
    }

    const projects: HackatimeProjectReport[] = rawProjects
      .filter((p) => linked.has(p.name) || p.seconds > 0)
      .map((p) => {
        const info = spanInfo.get(p.name);
        return {
          name: p.name,
          seconds: p.seconds,
          text: p.text,
          percent: p.percent,
          linked: linked.has(p.name),
          sessions: info?.sessions ?? 0,
          firstActivity: info?.first ?? null,
          lastActivity: info?.last ?? null,
          lapses: lapseInfo.get(p.name) ?? [],
        };
      })
      .sort((a, b) => Number(b.linked) - Number(a.linked) || b.seconds - a.seconds);

    return {
      ok: true,
      hackatimeUserId,
      totalSeconds: Number(data.total_seconds) || 0,
      humanReadableTotal: String(data.human_readable_total ?? ""),
      dailyAverageSeconds: Number(data.daily_average) || 0,
      rangeStart: typeof data.start === "string" ? data.start : null,
      rangeEnd: typeof data.end === "string" ? data.end : null,
      languages: projectLanguages.length > 0 ? projectLanguages : mapBreakdown(data.languages),
      languagesScoped: projectLanguages.length > 0,
      editors: mapBreakdown(data.editors),
      operatingSystems: mapBreakdown(data.operating_systems),
      machines: mapBreakdown(data.machines),
      projects,
    };
  } catch (e) {
    console.error("hackatime report fetch failed", (e as Error).message);
    return empty;
  }
}

function overlap(spans: Span[], from: number, to: number): number {
  let sum = 0;
  for (const s of spans) {
    if (s.end <= from) continue;
    if (s.start >= to) break;
    sum += Math.min(s.end, to) - Math.max(s.start, from);
  }
  return Math.max(0, Math.round(sum));
}

// Attribute tracked coding time to each commit: the seconds of Hackatime spans
// between the previous fetched commit and this one. The oldest fetched commit
// stays unknown (its window extends past what we fetched). Commits with ~zero
// tracked time behind them are a fraud signal , code appeared without coding.
export function attachTrackedTime(commits: Commit[], spans: Span[]): void {
  const dated = commits
    .filter((c) => c.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < dated.length; i++) {
    const from = new Date(dated[i - 1].date).getTime() / 1000;
    const to = new Date(dated[i].date).getTime() / 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    dated[i].tracked = overlap(spans, from, to);
  }
}
