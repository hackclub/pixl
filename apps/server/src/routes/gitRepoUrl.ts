// Ship-time check for a project's repo_url.
//
// This used to be isGithubRepoUrl in projects.ts, a literal
// `hostname === "github.com"`, which rejected Codeberg, GitLab, sr.ht and
// every self-hosted Forgejo/Gitea instance with repo_not_github (issue #28).
// Hack Club does not require GitHub anywhere else, so neither should Pixl.
//
// Rather than grow an allowlist forever, an unknown host is asked whether it
// is actually serving a Git repository, over Git's own smart HTTP discovery
// endpoint: GET <repo>/info/refs?service=git-upload-pack. Every real Git
// host answers it, because that is the first request `git clone` makes.
// GitHub, GitLab, Codeberg, Gitea/Forgejo, cgit and a bare git-http-backend
// behind nginx all serve it; a random blog or a Google Drive link does not.
//
// The well-known forges keep a pure fast path, so the overwhelmingly common
// case costs no network call at all and behaves exactly as it did before.

export interface GitProbeDeps {
  /**
   * Same SSRF guard urlAlive uses in projects.ts (rejects anything that
   * resolves to an internal address). Injected rather than imported so this
   * module stays unit-testable with no DNS.
   */
  hostIsPublic: (hostname: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const KNOWN_FORGE_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "bitbucket.org",
  "gitea.com",
  "git.sr.ht",
]);

export function isKnownForgeHost(hostname: string): boolean {
  return KNOWN_FORGE_HOSTS.has(hostname.replace(/^www\./, "").toLowerCase());
}

/** http(s) with at least one path segment. A bare origin is never a repo. */
export function parseRepoUrl(raw: unknown): URL | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (pathSegments(u) < 1) return null;
  return u;
}

function pathSegments(u: URL): number {
  return u.pathname.split("/").filter(Boolean).length;
}

export function gitDiscoveryUrl(u: URL): string {
  const probe = new URL(u.toString());
  probe.hash = "";
  probe.pathname = `${probe.pathname.replace(/\/+$/, "")}/info/refs`;
  probe.search = "?service=git-upload-pack";
  return probe.toString();
}

/**
 * Smart HTTP answers with a pkt-line advertisement ("001e# service=..."),
 * usually under its own content type. Dumb HTTP just serves the packed refs
 * file, "<sha>\t<refname>" per line. Accept either, since cgit and plain
 * static-file hosting still do the dumb version.
 */
export function looksLikeGitAdvertisement(contentType: string, bodyPrefix: string): boolean {
  if (contentType.toLowerCase().includes("application/x-git-upload-pack-advertisement")) return true;
  if (/^[0-9a-f]{4}# service=git-upload-pack/.test(bodyPrefix)) return true;
  return /^[0-9a-f]{40}\s+\S+/.test(bodyPrefix);
}

// Only ever pull the first chunk. The endpoint is small on a real repo, but
// an arbitrary player-supplied host could stream forever.
async function readBodyPrefix(res: Response, max = 256): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value ?? new Uint8Array()).slice(0, max);
  } catch {
    return "";
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function isGitRepoUrl(raw: unknown, deps: GitProbeDeps): Promise<boolean> {
  const u = parseRepoUrl(raw);
  if (!u) return false;

  // github.com/<user>/<repo> and friends, unchanged from the old check.
  if (isKnownForgeHost(u.hostname)) return pathSegments(u) >= 2;

  const { hostIsPublic, fetchImpl = fetch, timeoutMs = 8000 } = deps;

  // Redirects are followed by hand and the host re-validated at every hop,
  // exactly as urlAlive does: a public URL that 302s to 169.254.169.254 must
  // not slip through.
  let current = gitDiscoveryUrl(u);
  for (let hop = 0; hop < 5; hop++) {
    let cu: URL;
    try {
      cu = new URL(current);
    } catch {
      return false;
    }
    if (cu.protocol !== "https:" && cu.protocol !== "http:") return false;
    if (!(await hostIsPublic(cu.hostname))) return false;
    try {
      const res = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        // Some hosts only serve the advertisement to something that looks
        // like git; none of them mind an honest UA.
        headers: { "User-Agent": "git/2.43.0 (pixl ship check)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return false;
        current = new URL(loc, current).toString();
        continue;
      }
      if (!res.ok) return false;
      const contentType = res.headers.get("content-type") || "";
      if (looksLikeGitAdvertisement(contentType, "")) {
        res.body?.cancel().catch(() => {});
        return true;
      }
      return looksLikeGitAdvertisement(contentType, await readBodyPrefix(res));
    } catch {
      return false;
    }
  }
  return false; // too many redirects
}
