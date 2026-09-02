const API_BASE = "https://macondo.hackclub.com/api";
const CACHE_MS = 10 * 60_000;
const MAX_PAGES = 100;
const PAGE_BATCH_SIZE = 8;

interface JsonObject {
  readonly [key: string]: unknown;
}

type FetchResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false };

export interface MacondoJournal {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly hours: number;
  readonly createdAt: string;
  readonly archived: boolean;
}

export interface MacondoProject {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly repoUrl: string;
  readonly demoUrl: string;
  readonly thumbnailUrl: string;
  readonly createdAt: string;
  readonly ownerSlackId: string;
  readonly hasShipped: boolean;
  readonly journals: readonly MacondoJournal[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanField(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return value === "null" || value === "undefined" ? "" : value;
}

function preserveText(raw: unknown): string {
  const value = String(raw ?? "");
  return value === "null" || value === "undefined" ? "" : value;
}

function safeUrl(raw: unknown): string {
  const value = cleanField(raw);
  if (!value) return "";
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}

function positiveInteger(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function nonNegativeNumber(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseJournal(raw: unknown): MacondoJournal | null {
  if (!isObject(raw)) return null;
  const id = positiveInteger(raw.id);
  const longBrief = preserveText(raw.long_brief);
  const shortBrief = preserveText(raw.short_brief);
  const content = longBrief.trim() ? longBrief : shortBrief;
  const createdAt = cleanField(raw.created_at);
  if (id === null || !content || !createdAt) return null;
  return {
    id,
    title: cleanField(raw.short_brief).slice(0, 120),
    content,
    hours: nonNegativeNumber(raw.hours),
    createdAt,
    archived: raw.archived === true,
  };
}

export function parseMacondoProject(raw: unknown): MacondoProject | null {
  if (!isObject(raw) || !isObject(raw.owner)) return null;
  const id = positiveInteger(raw.id);
  const ownerSlackId = cleanField(raw.owner.slack_id);
  const createdAt = cleanField(raw.created_at);
  if (id === null || !ownerSlackId || !createdAt) return null;
  const journals = Array.isArray(raw.journals)
    ? raw.journals.flatMap((journal) => {
        const parsed = parseJournal(journal);
        return parsed === null ? [] : [parsed];
      })
    : [];
  return {
    id,
    name: cleanField(raw.name).slice(0, 120) || "Untitled project",
    description: cleanField(raw.description).slice(0, 2000),
    type: cleanField(raw.type),
    repoUrl: safeUrl(raw.repository_url),
    demoUrl: safeUrl(raw.demo_url),
    thumbnailUrl: safeUrl(raw.thumbnail_url),
    createdAt,
    ownerSlackId,
    hasShipped: raw.has_shipped === true,
    journals,
  };
}

async function fetchJson(path: string): Promise<FetchResult> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  }
}

interface ExplorePage {
  readonly items: readonly unknown[];
  readonly nextCursor: number | null;
}

async function fetchExplorePage(cursor: number): Promise<ExplorePage | null> {
  const response = await fetchJson(`/explore/projects?cursor=${cursor}`);
  if (!response.ok) return null;
  const raw = response.data;
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const nextCursor = Number(raw.next_cursor);
  return {
    items: raw.items,
    nextCursor: Number.isSafeInteger(nextCursor) ? nextCursor : null,
  };
}

let cache: { readonly at: number; readonly projects: readonly MacondoProject[] } | null = null;

async function loadExploreProjects(): Promise<readonly MacondoProject[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.projects;
  const projects: MacondoProject[] = [];
  const firstPage = await fetchExplorePage(0);
  if (!firstPage) return [];
  const firstProjects = firstPage.items.flatMap((item) => {
    const parsed = parseMacondoProject(item);
    return parsed === null ? [] : [parsed];
  });
  projects.push(...firstProjects);

  const pageStep = firstPage.nextCursor;
  if (pageStep === null || pageStep <= 0 || firstPage.items.length < pageStep) {
    cache = { at: Date.now(), projects };
    return projects;
  }

  let cursor = pageStep;
  for (let page = 1; page < MAX_PAGES; page += PAGE_BATCH_SIZE) {
    const cursors = Array.from(
      { length: Math.min(PAGE_BATCH_SIZE, MAX_PAGES - page) },
      (_, offset) => cursor + offset * pageStep,
    );
    const pages = await Promise.all(cursors.map(fetchExplorePage));
    let reachedEnd = false;
    for (const pageResult of pages) {
      if (!pageResult || pageResult.items.length === 0) {
        reachedEnd = true;
        continue;
      }
      projects.push(
        ...pageResult.items.flatMap((item) => {
          const parsed = parseMacondoProject(item);
          return parsed === null ? [] : [parsed];
        }),
      );
      if (pageResult.items.length < pageStep) reachedEnd = true;
    }
    if (reachedEnd) break;
    cursor += cursors.length * pageStep;
  }
  cache = { at: Date.now(), projects };
  return projects;
}

export async function macondoProjectsForSlackId(
  slackId: string,
): Promise<readonly MacondoProject[]> {
  const owner = cleanField(slackId);
  if (!owner) return [];
  const projects = await loadExploreProjects();
  return projects.filter((project) => project.ownerSlackId === owner);
}

export type MacondoProjectLookup =
  | { readonly kind: "found"; readonly project: MacondoProject }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

export async function macondoProjectForSlackId(
  slackId: string,
  projectId: number,
): Promise<MacondoProjectLookup> {
  const owner = cleanField(slackId);
  if (!owner || !Number.isSafeInteger(projectId) || projectId <= 0)
    return { kind: "not_found" };
  const response = await fetchJson(`/projects/${projectId}`);
  if (!response.ok) return { kind: "unavailable" };
  const raw = response.data;
  const project = parseMacondoProject(raw);
  if (!project || project.ownerSlackId !== owner || !isObject(raw))
    return { kind: "not_found" };
  const journalsResponse = await fetchJson(`/projects/${projectId}/journals`);
  if (!journalsResponse.ok || !Array.isArray(journalsResponse.data))
    return { kind: "unavailable" };
  const enriched = parseMacondoProject({ ...raw, journals: journalsResponse.data });
  if (!enriched) return { kind: "unavailable" };
  return {
    kind: "found",
    project: enriched,
  };
}
