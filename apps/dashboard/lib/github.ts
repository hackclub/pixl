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
}

function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && !u.hostname.endsWith(".github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

// In-memory cache of successful lookups only - an error is never cached, so
// a rate limit that's already cleared doesn't keep showing stale "no
// commits" for the rest of the window. Caching the success path still
// matters: without it, every single page view (and every Prev/Next click
// through the review queue) refetches even a repo that hasn't changed,
// which burns through the unauthenticated 60/hr limit *faster*, not slower.
const COMMITS_CACHE_TTL_MS = 5 * 60 * 1000;
const commitsCache = new Map<string, { result: CommitResult; at: number }>();

// Newest commits for a repo via the public GitHub API. Auth via GITHUB_TOKEN
// when present to lift the 60/hr unauthenticated rate limit.
export async function fetchCommits(repoUrl: string | null, limit = 50): Promise<CommitResult> {
  if (!repoUrl) return { repo: null, commits: [], error: null };
  const parsed = parseRepo(repoUrl);
  if (!parsed) return { repo: null, commits: [], error: "not_github" };

  const cacheKey = `${parsed.owner}/${parsed.repo}#${limit}`;
  const cached = commitsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < COMMITS_CACHE_TTL_MS) return cached.result;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pixl-dashboard",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const r = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=${limit}`,
      { headers, signal: AbortSignal.timeout(8000), cache: "no-store" },
    );
    if (r.status === 404) return { repo: `${parsed.owner}/${parsed.repo}`, commits: [], error: "not_found" };
    if (r.status === 403 || r.status === 429)
      return { repo: `${parsed.owner}/${parsed.repo}`, commits: [], error: "rate_limited" };
    if (!r.ok) return { repo: `${parsed.owner}/${parsed.repo}`, commits: [], error: `http_${r.status}` };
    const json = (await r.json()) as any[];
    const commits: Commit[] = (Array.isArray(json) ? json : []).map((c) => {
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
    });
    const result = { repo: `${parsed.owner}/${parsed.repo}`, commits, error: null };
    commitsCache.set(cacheKey, { result, at: Date.now() });
    return result;
  } catch {
    return { repo: `${parsed.owner}/${parsed.repo}`, commits: [], error: "fetch_failed" };
  }
}

// Per-commit line stats (additions/deletions) for the newest commits, so huge
// code dumps with barely any coded time behind them stand out. One API call
// per commit , capped and cached.
export async function attachCommitStats(result: CommitResult, cap = 20): Promise<void> {
  if (!result.repo || result.commits.length === 0) return;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pixl-dashboard",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const targets = result.commits.slice(0, cap);
  await Promise.allSettled(
    targets.map(async (c) => {
      const r = await fetch(`https://api.github.com/repos/${result.repo}/commits/${c.sha}`, {
        headers,
        signal: AbortSignal.timeout(8000),
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
