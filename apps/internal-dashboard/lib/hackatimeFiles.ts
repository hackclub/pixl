import { createConcurrencyLimiter } from "./concurrency";
import { fetchUserSpans } from "./hackatime";

// Time per file for a project's linked Hackatime projects, so a reviewer can see
// what the hours were spent on and what was spent outside the repo (terminal,
// AI tools, planning notes that are not committed). Hackatime's heartbeats carry
// the file ("entity") of every beat; the spans endpoint the rest of the
// dashboard uses does not.

const BASE = (process.env.HACKATIME_BASE ?? "https://hackatime.hackclub.com").replace(/\/$/, "");

// A heartbeat counts until the next one, but never for more than this: the same
// 2-minute idle rule Hackatime's own spans use.
const IDLE_CAP_SECONDS = 120;
const MAX_DAYS = 60;
const MAX_FILES = 60;

export interface Heartbeat {
  time: number;
  entity: string;
  project: string;
}

export interface FileTime {
  /** Repo-relative path when the file is under the project folder, else a short label. */
  path: string;
  seconds: number;
  /** Under a linked project's folder. False for the terminal, AI tools, other folders. */
  inProject: boolean;
}

export interface FileTimeReport {
  totalSeconds: number;
  inProjectSeconds: number;
  outsideSeconds: number;
  /** .md / .mdx files in the project, the usual "notes, not code" bucket. */
  markdownSeconds: number;
  files: FileTime[];
  /** Seconds in files beyond the MAX_FILES longest. */
  otherSeconds: number;
  /** Days that could not be fetched, so the totals may be short. */
  missingDays: number;
}

// "/Users/me/proj/src/a.ts" with project "proj" -> "src/a.ts". Anything not under
// a linked project's folder gets only its last two path parts, so a local user
// name or other folder names never reach the page.
export function relativeEntity(entity: string, projects: readonly string[]): { path: string; inProject: boolean } {
  const e = String(entity ?? "").replace(/\\/g, "/");
  for (const name of projects) {
    const marker = `/${name}/`;
    const i = e.indexOf(marker);
    if (i >= 0) {
      const rest = e.slice(i + marker.length);
      if (rest) return { path: rest, inProject: true };
    }
  }
  const parts = e.split("/").filter(Boolean);
  return { path: parts.slice(-2).join("/") || e || "(unknown)", inProject: false };
}

export function isMarkdown(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export function aggregateFileTime(
  heartbeats: readonly Heartbeat[],
  projects: readonly string[],
  missingDays = 0,
): FileTimeReport {
  const wanted = new Set(projects);
  const beats = heartbeats
    .filter((h) => wanted.has(h.project) && Number.isFinite(Number(h.time)))
    .map((h) => ({ ...h, time: Number(h.time) }))
    .sort((a, b) => a.time - b.time);
  const per = new Map<string, FileTime>();
  let total = 0;
  for (let i = 0; i < beats.length; i++) {
    const next = beats[i + 1];
    const dur = next ? Math.min(Math.max(next.time - beats[i]!.time, 0), IDLE_CAP_SECONDS) : IDLE_CAP_SECONDS;
    const { path, inProject } = relativeEntity(beats[i]!.entity, projects);
    const key = `${inProject ? "1" : "0"}:${path}`;
    const row = per.get(key) ?? { path, seconds: 0, inProject };
    row.seconds += dur;
    per.set(key, row);
    total += dur;
  }
  const all = [...per.values()].sort((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path));
  const inProjectSeconds = all.filter((f) => f.inProject).reduce((s, f) => s + f.seconds, 0);
  const markdownSeconds = all.filter((f) => f.inProject && isMarkdown(f.path)).reduce((s, f) => s + f.seconds, 0);
  const shown = all.slice(0, MAX_FILES);
  return {
    totalSeconds: total,
    inProjectSeconds,
    outsideSeconds: total - inProjectSeconds,
    markdownSeconds,
    files: shown,
    otherSeconds: all.slice(MAX_FILES).reduce((s, f) => s + f.seconds, 0),
    missingDays,
  };
}

function utcDays(spans: { start: number; end: number }[]): string[] {
  const days = new Set<string>();
  for (const s of spans) {
    for (let t = Math.floor(s.start / 86400) * 86400; t <= s.end; t += 86400) {
      days.add(new Date(t * 1000).toISOString().slice(0, 10));
    }
  }
  return [...days].sort();
}

export type FileTimeResult = { ok: true; report: FileTimeReport } | { ok: false; error: string };

// Needs the maker's own Hackatime token: /my/heartbeats returns the token
// owner's data. Only the days that have spans for the linked projects are
// requested, and only the linked projects' heartbeats are kept - the endpoint
// returns every project of that day, and the rest is never read further.
export async function fetchFileTime(
  slackId: string | null | undefined,
  token: string | null,
  projects: string[],
): Promise<FileTimeResult> {
  if (projects.length === 0) return { ok: false, error: "No Hackatime project is linked." };
  if (!token) return { ok: false, error: "This player has no Hackatime token stored." };
  const spans = await fetchUserSpans(slackId, token, projects);
  if (spans === null) return { ok: false, error: "Hackatime could not be reached." };
  const days = utcDays(spans);
  if (days.length === 0) return { ok: false, error: "No coding time found for the linked projects." };
  if (days.length > MAX_DAYS) return { ok: false, error: `Too many days (${days.length}) to load at once.` };

  const limit = createConcurrencyLimiter(4);
  const wanted = new Set(projects);
  let missingDays = 0;
  const beats: Heartbeat[] = [];
  await Promise.all(
    days.map((d) =>
      limit(async () => {
        try {
          const r = await fetch(
            `${BASE}/api/v1/my/heartbeats?start_time=${d}T00:00:00Z&end_time=${d}T23:59:59Z`,
            { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) },
          );
          if (!r.ok) {
            missingDays++;
            return;
          }
          const j = (await r.json()) as { heartbeats?: { time?: number; entity?: string; project?: string }[] };
          for (const h of j.heartbeats ?? []) {
            if (h.project && wanted.has(h.project))
              beats.push({ time: Number(h.time), entity: String(h.entity ?? ""), project: h.project });
          }
        } catch {
          missingDays++;
        }
      }),
    ),
  );
  if (missingDays === days.length) return { ok: false, error: "Hackatime did not return any heartbeats." };
  return { ok: true, report: aggregateFileTime(beats, projects, missingDays) };
}
