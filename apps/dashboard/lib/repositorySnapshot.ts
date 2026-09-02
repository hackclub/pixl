import { fetchCommits, parseRepo, type Commit } from "./github";

const MAX_FILES = 500;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const RAW_BASE = "https://raw.githubusercontent.com";

export type SnapshotFile = {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
};

export type RepositorySnapshot = {
  readonly repo: string;
  readonly revision: string;
  readonly files: readonly SnapshotFile[];
  readonly commits: readonly Commit[];
  readonly filesSeen: number;
  readonly filesOmitted: number;
};

export class RepositorySnapshotError extends Error {
  readonly name = "RepositorySnapshotError";

  constructor(message: string) {
    super(message);
  }
}

type GitHubTreeEntry = {
  readonly path: string;
  readonly type: string;
  readonly size?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTreeEntries(value: unknown): readonly GitHubTreeEntry[] {
  if (!isRecord(value) || !Array.isArray(value.tree)) return [];
  return value.tree.flatMap((entry): GitHubTreeEntry[] => {
    if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.type !== "string") return [];
    const size = typeof entry.size === "number" ? entry.size : undefined;
    return [{ path: entry.path, type: entry.type, ...(size === undefined ? {} : { size }) }];
  });
}

function isSkippablePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(\.git|node_modules|vendor|dist|build|\.next|coverage|target)(\/|$)/.test(lower)) return true;
  if (/(^|\/)(\.env|\.env\.|.*\.(pem|key|p12|pfx|crt|cer|der|keystore))$/i.test(path)) return true;
  if (/(^|\/)(credentials?|secrets?|service-account|id_rsa)(\.|\/|$)/i.test(path)) return true;
  return /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|mp3|wav|mp4|mov|avi|zip|gz|7z|pdf|woff2?|ttf|otf|exe|dmg|bin)$/i.test(path);
}

function pathPriority(path: string): number {
  if (/^readme(?:\.|$)/i.test(path)) return 0;
  if (/^(package\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|cargo\.toml|go\.mod|pyproject\.toml)$/i.test(path)) return 1;
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\./i.test(path)) return 2;
  if (/\.(md|mdx|txt)$/i.test(path)) return 3;
  return 4;
}

function headers(): Record<string, string> {
  const result: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pixl-ai-review",
  };
  if (process.env.GITHUB_TOKEN) result.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return result;
}

async function readGitHubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new RepositorySnapshotError(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

async function readRawFile(owner: string, repo: string, revision: string, path: string): Promise<string> {
  const response = await fetch(
    `${RAW_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(revision)}/${path.split("/").map(encodeURIComponent).join("/")}`,
    { headers: headers(), signal: AbortSignal.timeout(15_000), cache: "no-store" },
  );
  if (!response.ok) throw new RepositorySnapshotError(`GitHub file fetch returned HTTP ${response.status}`);
  const content = await response.text();
  if (content.includes("\u0000")) throw new RepositorySnapshotError("binary file");
  return content;
}

export async function fetchRepositorySnapshot(repoUrl: string | null): Promise<RepositorySnapshot> {
  const parsed = repoUrl ? parseRepo(repoUrl) : null;
  if (!parsed) throw new RepositorySnapshotError("project does not have a GitHub repository");
  const base = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const metadata = await readGitHubJson(base);
  if (!isRecord(metadata) || metadata.private === true)
    throw new RepositorySnapshotError("repository is not public");
  const branch = typeof metadata.default_branch === "string" ? metadata.default_branch : "main";
  const tree = await readGitHubJson(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const revision = isRecord(tree) && typeof tree.sha === "string" ? tree.sha : branch;
  const allEntries = readTreeEntries(tree).filter((entry) => entry.type === "blob");
  const entries = allEntries.filter((entry) => !isSkippablePath(entry.path));
  const eligible = [...entries].sort((a, b) => pathPriority(a.path) - pathPriority(b.path) || a.path.localeCompare(b.path));
  const selected = eligible.slice(0, MAX_FILES).filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES);
  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  for (const entry of selected) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const content = await readRawFile(parsed.owner, parsed.repo, revision, entry.path);
      const bytes = new TextEncoder().encode(content).byteLength;
      if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) continue;
      files.push({ path: entry.path, content, bytes });
      totalBytes += bytes;
    } catch (error) {
      if (!(error instanceof RepositorySnapshotError)) throw error;
    }
  }
  if (files.length === 0) throw new RepositorySnapshotError("repository had no readable text files");
  const commits = await fetchCommits(repoUrl, 50);
  return {
    repo: `${parsed.owner}/${parsed.repo}`,
    revision,
    files,
    commits: commits.commits,
    filesSeen: files.length,
    filesOmitted: allEntries.length - files.length,
  };
}
