// Commit history for a project's repo, across git hosts.
//
// This was lib/github.ts and only ever spoke to api.github.com, which was
// fine while ship-time validation rejected anything that wasn't GitHub. That
// restriction is gone (apps/server's gitRepoUrl.ts now accepts any host
// serving git smart HTTP, issue #28), so a reviewer opening a Codeberg or
// self-hosted Forgejo ship would have been shown an empty Commits tab.
//
// Three API dialects cover essentially everything people actually ship on:
//   github   api.github.com/repos/<owner>/<repo>/commits
//   forgejo  <host>/api/v1/repos/<owner>/<repo>/commits   (Codeberg, Gitea)
//   gitlab   <host>/api/v4/projects/<urlencoded path>/repository/commits
// Known hosts map straight to a dialect. An unknown host gets probed:
// Forgejo/Gitea first (by far the most common thing to self-host), then
// GitLab. Both are plain GETs, so a miss costs two requests and is cached.

import { safeJsonGet, type SafeJsonResult, type SsrfGuardDeps } from "./ssrfGuard";

export type GitProvider = "github" | "forgejo" | "gitlab";

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
  tracked?: number;
  additions?: number;
  deletions?: number;
  ai?: boolean;
}

const AI_MESSAGE_RX =
  /co-authored-by:.*(claude|copilot|chatgpt|gpt|cursor|devin|aider|codex|gemini|jules|windsurf)|generated with \[?(claude|chatgpt|cursor|copilot|aider|codex)|🤖 generated/i;
const AI_AUTHOR_RX =
  /(^|\b)(claude|copilot|devin-ai|cursor-?agent|aider|codex|jules|chatgpt)(\b|\[bot\])|noreply@anthropic\.com|bot@openai\.com/i;

// Flags commits that AI tooling signed (co-author trailers, bot authors,
// "generated with" footers). Absence of a flag proves nothing , it only
// catches tools that announce themselves.
function looksAiAuthored(fullMessage: string, author: string, email: string): boolean {
  return (
    AI_MESSAGE_RX.test(fullMessage) || AI_AUTHOR_RX.test(author) || AI_AUTHOR_RX.test(email)
  );
}

export interface CommitResult {
  repo: string | null;
  commits: Commit[];
  error: string | null;
  /** The host's own message, when it refused for a reason worth reading
   * verbatim (a 403 that isn't a rate limit). */
  detail?: string;
  /** Which dialect answered. attachCommitStats needs it, and the UI names
   * the host rather than saying "GitHub" at a Codeberg user. */
  provider?: GitProvider;
  host?: string;
  /** Whether the host indicates additional commits exist past this page. */
  hasMore?: boolean;
}

export interface RepoRef {
  provider: GitProvider | null;
  host: string;
  /** "owner/name" for github and forgejo; the full (possibly nested) project
   * path for gitlab, which allows subgroups. */
  path: string;
}

const KNOWN_HOSTS: Record<string, GitProvider> = {
  "github.com": "github",
  "codeberg.org": "forgejo",
  "gitea.com": "forgejo",
  "gitlab.com": "gitlab",
};

const SEGMENT_RX = /^[A-Za-z0-9._-]{1,100}$/;

function isSafeSegment(segment: string): boolean {
  return SEGMENT_RX.test(segment) && segment !== "." && segment !== "..";
}

export function parseRepoRef(url: string | null | undefined): RepoRef | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const hostname = u.hostname.replace(/^www\./, "").toLowerCase();
  // A self-hosted Forgejo/Gitea commonly runs on a non-default port (Gitea's
  // own default is 3000) - dropping it here would silently point every
  // request this file makes at the wrong port instead of the one the player
  // actually gave.
  const host = u.port ? `${hostname}:${u.port}` : hostname;

  // GitLab hangs everything after the project behind a literal "/-/" segment
  // (/-/tree/main, /-/issues), and allows nested subgroups before it.
  const parts = u.pathname.split("/").filter(Boolean);
  const dash = parts.indexOf("-");
  const projectParts = dash === -1 ? parts : parts.slice(0, dash);
  if (projectParts.length < 2) return null;
  projectParts[projectParts.length - 1] = projectParts[projectParts.length - 1].replace(/\.git$/, "");

  const provider = KNOWN_HOSTS[hostname] ?? (hostname.endsWith(".github.com") ? "github" : null);
  const pathParts = provider === "gitlab" ? projectParts : projectParts.slice(0, 2);
  if (!pathParts.every(isSafeSegment)) return null;
  return { provider, host, path: pathParts.join("/") };
}

const COMMITS_CACHE_TTL_MS = 5 * 60 * 1000;
// Successful lookups only - an error is never cached, so a rate limit that's
// already cleared doesn't keep showing stale "no commits" for the rest of the
// window. Caching the success path still matters: without it, every page view
// (and every Prev/Next click through the review queue) refetches even a repo
// that hasn't changed, which burns through an unauthenticated limit *faster*.
const commitsCache = new Map<string, { result: CommitResult; at: number }>();

// Cache only raw repository evidence. Review pages add project-specific
// Hackatime timings and line stats, so every caller needs its own commit objects.
function copyCommitResult(result: CommitResult): CommitResult {
  return { ...result, commits: result.commits.map((commit) => ({ ...commit })) };
}

const BASE_HEADERS = { "User-Agent": "pixl-dashboard" };

// A 403 means either "you're out of quota" or "policy says no", and they're
// nothing alike: only the first is worth waiting out. x-ratelimit-remaining
// tells them apart on GitHub; GitLab and Forgejo just use 429.
function isRateLimit(r: Response): boolean {
  if (r.status === 429) return true;
  return r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0";
}

// Hack Club's GitHub enterprise rejects fine-grained PATs with a lifetime
// over 366 days, so GITHUB_TOKEN 403s on every hackclub-org repo while
// working fine everywhere else. Those repos are public, so retrying with no
// token at all succeeds - far better than showing a reviewer an empty
// Commits tab. Costs nothing when the token is accepted (the common case)
// since the retry only fires on a non-quota 403.
async function ghFetch(url: string, init?: RequestInit, accept = "application/vnd.github+json"): Promise<Response> {
  const headers = { ...BASE_HEADERS, Accept: accept };
  const opts: RequestInit = { signal: AbortSignal.timeout(8000), ...init };
  const token = process.env.GITHUB_TOKEN;
  if (!token) return fetch(url, { ...opts, headers });

  const authed = await fetch(url, {
    ...opts,
    headers: { ...headers, Authorization: `Bearer ${token}` },
  });
  if (authed.status !== 403 || isRateLimit(authed)) return authed;
  return fetch(url, { ...opts, headers });
}

// Both optional. Public repos on Codeberg and gitlab.com read fine
// unauthenticated; a token only matters for a private instance or a tighter
// self-hosted rate limit.
//
// Unlike ghFetch (fixed api.github.com target), these two hit a
// player-supplied host - see parseRepoRef's KNOWN_HOSTS fallback below, which
// accepts any hostname. apps/server's ship-time isGitRepoUrl check validates
// that host is public at ship time only; this fetch can run again on every
// review page view, potentially long after, so it has to re-validate (and
// pin DNS against rebinding to) the host itself, right before sending
// FORGEJO_TOKEN/GITLAB_TOKEN - see lib/ssrfGuard.ts.
//
// exact authority only
const CONFIGURED_HOST_RX = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function authorityOf(host: string): string | null {
  try {
    const u = new URL(`https://${host}`);
    return `${u.hostname}:${u.port || "443"}`;
  } catch {
    return null;
  }
}

function trustedTokenHost(host: string, envVar: string): boolean {
  const configured = process.env[envVar]?.trim();
  if (!configured || !CONFIGURED_HOST_RX.test(configured)) return false;
  const want = authorityOf(configured);
  return want !== null && want === authorityOf(host);
}

function forgejoFetch(url: string, host: string, deps?: SsrfGuardDeps): Promise<SafeJsonResult | null> {
  const headers: Record<string, string> = { ...BASE_HEADERS, Accept: "application/json" };
  if (trustedTokenHost(host, "FORGEJO_HOST") && process.env.FORGEJO_TOKEN)
    headers.Authorization = `token ${process.env.FORGEJO_TOKEN}`;
  return safeJsonGet(url, headers, deps);
}

function gitlabFetch(url: string, host: string, deps?: SsrfGuardDeps): Promise<SafeJsonResult | null> {
  const headers: Record<string, string> = { ...BASE_HEADERS, Accept: "application/json" };
  if (trustedTokenHost(host, "GITLAB_HOST") && process.env.GITLAB_TOKEN)
    headers["PRIVATE-TOKEN"] = process.env.GITLAB_TOKEN;
  return safeJsonGet(url, headers, deps);
}

function fail(ref: RepoRef, error: string, detail?: string): CommitResult {
  return { repo: ref.path, commits: [], error, detail, provider: ref.provider ?? undefined, host: ref.host };
}

function mapGithubCommit(c: any): Commit {
  const fullMessage = String(c.commit?.message ?? "");
  const author = String(c.author?.login ?? c.commit?.author?.name ?? "?");
  const email = String(c.commit?.author?.email ?? "");
  return {
    sha: String(c.sha ?? "").slice(0, 7),
    message: fullMessage.split("\n")[0].slice(0, 200),
    author,
    date: String(c.commit?.author?.date ?? ""),
    url: String(c.html_url ?? ""),
    ai: looksAiAuthored(fullMessage, author, email) || undefined,
  };
}

async function fetchGithub(ref: RepoRef, limit: number, page = 1): Promise<CommitResult> {
  const perPage = Math.min(limit, 100);
  const url =
    page === 1
      ? `https://api.github.com/repos/${ref.path}/commits?per_page=${perPage}`
      : `https://api.github.com/repos/${ref.path}/commits?per_page=${perPage}&page=${page}`;

  const r = await ghFetch(url, { cache: "no-store" });
  if (r.status === 404) return fail(ref, "not_found");
  if (isRateLimit(r)) return fail(ref, "rate_limited");
  if (r.status === 403) {
    let why = "";
    try {
      why = String(((await r.json()) as { message?: string }).message ?? "").slice(0, 300);
    } catch {}
    return fail(ref, "forbidden", why);
  }
  if (!r.ok) return fail(ref, `http_${r.status}`);

  let json: any[];
  try {
    json = (await r.json()) as any[];
  } catch {
    return fail(ref, "fetch_failed");
  }
  if (!Array.isArray(json)) return fail(ref, "fetch_failed");

  const commits = json.map(mapGithubCommit);
  const link = r.headers.get("link");
  const hasMore = link ? link.includes('rel="next"') : commits.length === perPage;

  return { repo: ref.path, commits, error: null, provider: "github", host: ref.host, hasMore };
}

function mapForgejoCommit(c: any): Commit {
  const fullMessage = String(c.commit?.message ?? "");
  const author = String(c.author?.login ?? c.commit?.author?.name ?? "?");
  const email = String(c.commit?.author?.email ?? "");
  return {
    sha: String(c.sha ?? "").slice(0, 7),
    message: fullMessage.split("\n")[0].slice(0, 200),
    author,
    date: String(c.commit?.author?.date ?? c.created ?? ""),
    url: String(c.html_url ?? ""),
    additions: c.stats ? Number(c.stats.additions) || 0 : undefined,
    deletions: c.stats ? Number(c.stats.deletions) || 0 : undefined,
    ai: looksAiAuthored(fullMessage, author, email) || undefined,
  };
}

// Gitea/Forgejo. `stat=true` inlines per-commit additions/deletions, so
// unlike GitHub this needs no follow-up request per commit.
async function fetchForgejo(ref: RepoRef, limit: number, page = 1, deps?: SsrfGuardDeps): Promise<CommitResult | null> {
  const perPage = Math.min(limit, 50);
  const commits: Commit[] = [];
  const startP = (page - 1) * Math.ceil(limit / perPage) + 1;
  const endP = startP + Math.ceil(limit / perPage);
  let hasMore = false;

  for (let p = startP; p < endP; p++) {
    const url =
      p === 1
        ? `https://${ref.host}/api/v1/repos/${ref.path}/commits?limit=${perPage}&stat=true`
        : `https://${ref.host}/api/v1/repos/${ref.path}/commits?limit=${perPage}&stat=true&page=${p}`;

    const r = await forgejoFetch(url, ref.host, deps);
    if (!r) return p === startP ? (ref.provider ? fail(ref, "fetch_failed") : null) : null;
    if (r.status === 404) return p === startP ? (ref.provider ? fail(ref, "not_found") : null) : null;
    if (r.status === 429) return fail(ref, "rate_limited");
    if (r.status < 200 || r.status >= 300) return p === startP ? (ref.provider ? fail(ref, `http_${r.status}`) : null) : null;

    const json = r.json;
    if (!Array.isArray(json)) return p === startP ? null : null;
    if (json.length === 0) {
      hasMore = false;
      break;
    }

    for (const c of json) {
      commits.push(mapForgejoCommit(c));
    }

    if (json.length < perPage) {
      hasMore = false;
      break;
    }
    hasMore = true;
  }

  return { repo: ref.path, commits, error: null, provider: "forgejo", host: ref.host, hasMore };
}

function mapGitlabCommit(c: any): Commit {
  const fullMessage = String(c.message ?? c.title ?? "");
  const author = String(c.author_name ?? "?");
  const email = String(c.author_email ?? "");
  return {
    sha: String(c.short_id ?? c.id ?? "").slice(0, 7),
    message: fullMessage.split("\n")[0].slice(0, 200),
    author,
    date: String(c.committed_date ?? c.created_at ?? ""),
    url: String(c.web_url ?? ""),
    additions: c.stats ? Number(c.stats.additions) || 0 : undefined,
    deletions: c.stats ? Number(c.stats.deletions) || 0 : undefined,
    ai: looksAiAuthored(fullMessage, author, email) || undefined,
  };
}

// GitLab wants the project path url-encoded into a single segment.
// `with_stats=true` inlines additions/deletions, same as Forgejo.
async function fetchGitlab(ref: RepoRef, limit: number, page = 1, deps?: SsrfGuardDeps): Promise<CommitResult | null> {
  const id = encodeURIComponent(ref.path);
  const perPage = Math.min(limit, 100);
  const url =
    page === 1
      ? `https://${ref.host}/api/v4/projects/${id}/repository/commits?per_page=${perPage}&with_stats=true`
      : `https://${ref.host}/api/v4/projects/${id}/repository/commits?per_page=${perPage}&with_stats=true&page=${page}`;

  const r = await gitlabFetch(url, ref.host, deps);
  if (!r) return ref.provider ? fail(ref, "fetch_failed") : null;
  if (r.status === 404) return ref.provider ? fail(ref, "not_found") : null;
  if (r.status === 429) return fail(ref, "rate_limited");
  if (r.status < 200 || r.status >= 300) return ref.provider ? fail(ref, `http_${r.status}`) : null;
  const json = r.json;
  if (!Array.isArray(json)) return null;
  const commits = json.map(mapGitlabCommit);
  const hasMore = commits.length === perPage;
  return { repo: ref.path, commits, error: null, provider: "gitlab", host: ref.host, hasMore };
}

// ponytail: default limit is 100 commits per page; reviewer UI loads subsequent pages of 100 on demand.
export const DEFAULT_COMMIT_LIMIT = 100;

export async function fetchCommits(
  repoUrl: string | null,
  limit = DEFAULT_COMMIT_LIMIT,
  pageOrDeps?: number | SsrfGuardDeps,
  deps?: SsrfGuardDeps,
): Promise<CommitResult> {
  const page = typeof pageOrDeps === "number" ? Math.max(1, pageOrDeps) : 1;
  const actualDeps = typeof pageOrDeps === "object" ? pageOrDeps : deps;

  if (!repoUrl) return { repo: null, commits: [], error: null };
  const ref = parseRepoRef(repoUrl);
  if (!ref) return { repo: null, commits: [], error: "unsupported_host" };

  const cacheKey = `${ref.provider ?? "probe"}:${ref.host}/${ref.path}#${limit}@${page}`;
  const cached = commitsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COMMITS_CACHE_TTL_MS) return copyCommitResult(cached.result);

  let result: CommitResult;
  try {
    if (ref.provider === "github") {
      result = await fetchGithub(ref, limit, page);
    } else if (ref.provider === "gitlab") {
      result = (await fetchGitlab(ref, limit, page, actualDeps)) ?? fail(ref, "fetch_failed");
    } else if (ref.provider === "forgejo") {
      result = (await fetchForgejo(ref, limit, page, actualDeps)) ?? fail(ref, "fetch_failed");
    } else {
      // Unknown host: whichever dialect answers with a real commit array wins.
      result =
        (await fetchForgejo(ref, limit, page, actualDeps)) ??
        (await fetchGitlab(ref, limit, page, actualDeps)) ??
        fail(ref, "unsupported_host");
    }
  } catch {
    return fail(ref, "fetch_failed");
  }
  if (!result.error) commitsCache.set(cacheKey, { result, at: Date.now() });
  return copyCommitResult(result);
}

// Per-commit line stats, so huge code dumps with barely any coded time behind
// them stand out. Only GitHub needs this: its list endpoint omits stats, so
// it costs one extra API call per commit (capped and cached). Forgejo and
// GitLab already inlined them in fetchCommits.
export async function attachCommitStats(result: CommitResult, cap = 20): Promise<void> {
  if (result.provider !== "github") return;
  if (!result.repo || result.commits.length === 0) return;

  const targets = result.commits.slice(0, cap);
  await Promise.allSettled(
    targets.map(async (c) => {
      const r = await ghFetch(`https://api.github.com/repos/${result.repo}/commits/${c.sha}`, {
        next: { revalidate: 3600 },
      });
      if (!r.ok) return;
      const json = (await r.json()) as {
        stats?: { additions?: number; deletions?: number };
      };
      if (json.stats) {
        c.additions = Number(json.stats.additions) || 0;
        c.deletions = Number(json.stats.deletions) || 0;
      }
    }),
  );
}

// ---- One commit's diff, and the README (review page: Commits and README tabs) ----

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff hunks. Missing for binary files and anything the host
   * decided was too large to inline. */
  patch: string | null;
  /** The patch was cut off at PATCH_CAP. */
  truncated?: boolean;
}

export interface CommitDiff {
  files: DiffFile[];
  /** More files changed than were returned. */
  moreFiles: number;
  error: string | null;
}

const DIFF_FILE_CAP = 40;
const PATCH_CAP = 20_000;
const SHA_RX = /^[0-9a-f]{7,40}$/i;

function capPatch(patch: unknown): Pick<DiffFile, "patch" | "truncated"> {
  if (typeof patch !== "string" || !patch) return { patch: null };
  if (patch.length <= PATCH_CAP) return { patch };
  return { patch: patch.slice(0, PATCH_CAP), truncated: true };
}

const diffCache = new Map<string, { result: CommitDiff; at: number }>();

// A commit never changes, so a successful diff is cached for the process's
// lifetime window below; errors are not cached.
export async function fetchCommitDiff(
  repoUrl: string | null,
  sha: string,
  deps?: SsrfGuardDeps,
): Promise<CommitDiff> {
  const ref = parseRepoRef(repoUrl);
  if (!ref || !SHA_RX.test(sha)) return { files: [], moreFiles: 0, error: "unsupported" };
  const key = `${ref.host}/${ref.path}@${sha}`;
  const hit = diffCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.result;

  let result: CommitDiff;
  try {
    if (ref.provider === "github") {
      const r = await ghFetch(`https://api.github.com/repos/${ref.path}/commits/${sha}`, { cache: "no-store" });
      if (isRateLimit(r)) return { files: [], moreFiles: 0, error: "rate_limited" };
      if (!r.ok) return { files: [], moreFiles: 0, error: r.status === 404 ? "not_found" : `http_${r.status}` };
      const json = (await r.json()) as { files?: any[] };
      const all = Array.isArray(json.files) ? json.files : [];
      result = {
        files: all.slice(0, DIFF_FILE_CAP).map((f) => ({
          path: String(f.filename ?? "?"),
          status: String(f.status ?? "modified"),
          additions: Number(f.additions) || 0,
          deletions: Number(f.deletions) || 0,
          ...capPatch(f.patch),
        })),
        moreFiles: Math.max(0, all.length - DIFF_FILE_CAP),
        error: null,
      };
    } else if (ref.provider === "gitlab") {
      const r = await gitlabFetch(
        `https://${ref.host}/api/v4/projects/${encodeURIComponent(ref.path)}/repository/commits/${sha}/diff?per_page=${DIFF_FILE_CAP}`,
        ref.host,
        deps,
      );
      if (!r || r.status < 200 || r.status >= 300 || !Array.isArray(r.json))
        return { files: [], moreFiles: 0, error: r?.status === 404 ? "not_found" : "fetch_failed" };
      result = {
        files: (r.json as any[]).map((f) => {
          const patch = capPatch(f.diff);
          const lines = (patch.patch ?? "").split("\n");
          return {
            path: String(f.new_path ?? f.old_path ?? "?"),
            status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified",
            additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
            deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
            ...patch,
          };
        }),
        moreFiles: 0,
        error: null,
      };
    } else {
      // Forgejo/Gitea's JSON API lists a commit's files without their patches.
      return { files: [], moreFiles: 0, error: "unsupported" };
    }
  } catch {
    return { files: [], moreFiles: 0, error: "fetch_failed" };
  }
  diffCache.set(key, { result, at: Date.now() });
  return result;
}

export interface RepoReadme {
  /** "html" is GitHub's own sanitized rendering; "markdown" is the raw file
   * for hosts that don't render it for us. */
  kind: "html" | "markdown" | null;
  content: string;
  /** Base for relative links and images inside the README. */
  baseHref: string | null;
  error: string | null;
}

const README_CAP = 400_000;
const readmeCache = new Map<string, { result: RepoReadme; at: number }>();

function noReadme(error: string): RepoReadme {
  return { kind: null, content: "", baseHref: null, error };
}

function fromBase64(content: unknown): string {
  return typeof content === "string" ? Buffer.from(content, "base64").toString("utf8").slice(0, README_CAP) : "";
}

export async function fetchReadme(repoUrl: string | null, deps?: SsrfGuardDeps): Promise<RepoReadme> {
  const ref = parseRepoRef(repoUrl);
  if (!ref) return noReadme("unsupported");
  const key = `${ref.host}/${ref.path}`;
  const hit = readmeCache.get(key);
  if (hit && Date.now() - hit.at < COMMITS_CACHE_TTL_MS) return hit.result;

  let result: RepoReadme;
  try {
    if (ref.provider === "github") {
      // GitHub renders and sanitizes it for us, exactly as github.com shows it
      // (tables, task lists, alerts, HTML blocks, proxied images).
      const r = await ghFetch(
        `https://api.github.com/repos/${ref.path}/readme`,
        { cache: "no-store" },
        "application/vnd.github.html+json",
      );
      if (r.status === 404) return noReadme("not_found");
      if (isRateLimit(r)) return noReadme("rate_limited");
      if (!r.ok) return noReadme(`http_${r.status}`);
      result = {
        kind: "html",
        content: (await r.text()).slice(0, README_CAP),
        baseHref: `https://github.com/${ref.path}/raw/HEAD/`,
        error: null,
      };
    } else if (ref.provider === "gitlab") {
      const r = await gitlabFetch(
        `https://${ref.host}/api/v4/projects/${encodeURIComponent(ref.path)}/repository/files/README.md?ref=HEAD`,
        ref.host,
        deps,
      );
      if (!r || r.status < 200 || r.status >= 300) return noReadme(r?.status === 404 ? "not_found" : "fetch_failed");
      result = {
        kind: "markdown",
        content: fromBase64((r.json as { content?: string }).content),
        baseHref: `https://${ref.host}/${ref.path}/-/raw/HEAD/`,
        error: null,
      };
    } else {
      const r = await forgejoFetch(`https://${ref.host}/api/v1/repos/${ref.path}/contents/README.md`, ref.host, deps);
      if (!r || r.status < 200 || r.status >= 300) return noReadme(r?.status === 404 ? "not_found" : "fetch_failed");
      result = {
        kind: "markdown",
        content: fromBase64((r.json as { content?: string }).content),
        baseHref: `https://${ref.host}/${ref.path}/raw/branch/HEAD/`,
        error: null,
      };
    }
  } catch {
    return noReadme("fetch_failed");
  }
  readmeCache.set(key, { result, at: Date.now() });
  return result;
}
