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

export function parseRepoRef(url: string | null | undefined): RepoRef | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // GitLab hangs everything after the project behind a literal "/-/" segment
  // (/-/tree/main, /-/issues), and allows nested subgroups before it.
  const parts = u.pathname.split("/").filter(Boolean);
  const dash = parts.indexOf("-");
  const projectParts = dash === -1 ? parts : parts.slice(0, dash);
  if (projectParts.length < 2) return null;
  projectParts[projectParts.length - 1] = projectParts[projectParts.length - 1].replace(/\.git$/, "");

  const provider = KNOWN_HOSTS[host] ?? (host.endsWith(".github.com") ? "github" : null);
  const path = provider === "gitlab" ? projectParts.join("/") : projectParts.slice(0, 2).join("/");
  return { provider, host, path };
}

const COMMITS_CACHE_TTL_MS = 5 * 60 * 1000;
// Successful lookups only - an error is never cached, so a rate limit that's
// already cleared doesn't keep showing stale "no commits" for the rest of the
// window. Caching the success path still matters: without it, every page view
// (and every Prev/Next click through the review queue) refetches even a repo
// that hasn't changed, which burns through an unauthenticated limit *faster*.
const commitsCache = new Map<string, { result: CommitResult; at: number }>();

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
async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...BASE_HEADERS, Accept: "application/vnd.github+json" };
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
function forgejoFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...BASE_HEADERS, Accept: "application/json" };
  if (process.env.FORGEJO_TOKEN) headers.Authorization = `token ${process.env.FORGEJO_TOKEN}`;
  return fetch(url, { signal: AbortSignal.timeout(8000), ...init, headers });
}

function gitlabFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...BASE_HEADERS, Accept: "application/json" };
  if (process.env.GITLAB_TOKEN) headers["PRIVATE-TOKEN"] = process.env.GITLAB_TOKEN;
  return fetch(url, { signal: AbortSignal.timeout(8000), ...init, headers });
}

function fail(ref: RepoRef, error: string, detail?: string): CommitResult {
  return { repo: ref.path, commits: [], error, detail, provider: ref.provider ?? undefined, host: ref.host };
}

async function fetchGithub(ref: RepoRef, limit: number): Promise<CommitResult> {
  const r = await ghFetch(`https://api.github.com/repos/${ref.path}/commits?per_page=${limit}`, {
    cache: "no-store",
  });
  if (r.status === 404) return fail(ref, "not_found");
  if (isRateLimit(r)) return fail(ref, "rate_limited");
  // Not a quota problem - surface what GitHub actually said instead of
  // sending whoever reads this off chasing a rate limit that isn't there.
  if (r.status === 403) {
    let why = "";
    try {
      why = String(((await r.json()) as { message?: string }).message ?? "").slice(0, 300);
    } catch {}
    return fail(ref, "forbidden", why);
  }
  if (!r.ok) return fail(ref, `http_${r.status}`);
  const json = (await r.json()) as any[];
  const commits = (Array.isArray(json) ? json : []).map((c) => {
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
    } satisfies Commit;
  });
  return { repo: ref.path, commits, error: null, provider: "github", host: ref.host };
}

// Gitea/Forgejo. `stat=true` inlines per-commit additions/deletions, so
// unlike GitHub this needs no follow-up request per commit.
async function fetchForgejo(ref: RepoRef, limit: number): Promise<CommitResult | null> {
  const r = await forgejoFetch(
    `https://${ref.host}/api/v1/repos/${ref.path}/commits?limit=${limit}&stat=true`,
    { cache: "no-store" },
  );
  if (r.status === 404) return ref.provider ? fail(ref, "not_found") : null;
  if (isRateLimit(r)) return fail(ref, "rate_limited");
  if (!r.ok) return ref.provider ? fail(ref, `http_${r.status}`) : null;
  let json: any;
  try {
    json = await r.json();
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  const commits = json.map((c) => {
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
    } satisfies Commit;
  });
  return { repo: ref.path, commits, error: null, provider: "forgejo", host: ref.host };
}

// GitLab wants the project path url-encoded into a single segment.
// `with_stats=true` inlines additions/deletions, same as Forgejo.
async function fetchGitlab(ref: RepoRef, limit: number): Promise<CommitResult | null> {
  const id = encodeURIComponent(ref.path);
  const r = await gitlabFetch(
    `https://${ref.host}/api/v4/projects/${id}/repository/commits?per_page=${limit}&with_stats=true`,
    { cache: "no-store" },
  );
  if (r.status === 404) return ref.provider ? fail(ref, "not_found") : null;
  if (isRateLimit(r)) return fail(ref, "rate_limited");
  if (!r.ok) return ref.provider ? fail(ref, `http_${r.status}`) : null;
  let json: any;
  try {
    json = await r.json();
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  const commits = json.map((c) => {
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
    } satisfies Commit;
  });
  return { repo: ref.path, commits, error: null, provider: "gitlab", host: ref.host };
}

export async function fetchCommits(repoUrl: string | null, limit = 50): Promise<CommitResult> {
  if (!repoUrl) return { repo: null, commits: [], error: null };
  const ref = parseRepoRef(repoUrl);
  if (!ref) return { repo: null, commits: [], error: "unsupported_host" };

  const cacheKey = `${ref.provider ?? "probe"}:${ref.host}/${ref.path}#${limit}`;
  const cached = commitsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COMMITS_CACHE_TTL_MS) return cached.result;

  let result: CommitResult;
  try {
    if (ref.provider === "github") {
      result = await fetchGithub(ref, limit);
    } else if (ref.provider === "gitlab") {
      result = (await fetchGitlab(ref, limit)) ?? fail(ref, "fetch_failed");
    } else if (ref.provider === "forgejo") {
      result = (await fetchForgejo(ref, limit)) ?? fail(ref, "fetch_failed");
    } else {
      // Unknown host: whichever dialect answers with a real commit array wins.
      result =
        (await fetchForgejo(ref, limit)) ??
        (await fetchGitlab(ref, limit)) ??
        fail(ref, "unsupported_host");
    }
  } catch {
    return fail(ref, "fetch_failed");
  }
  if (!result.error) commitsCache.set(cacheKey, { result, at: Date.now() });
  return result;
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
