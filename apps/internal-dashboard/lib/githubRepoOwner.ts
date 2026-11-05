export function githubRepoOwnerProfile(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;
  try {
    const url = new URL(repoUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      (url.hostname !== "github.com" && url.hostname !== "www.github.com") ||
      url.username ||
      url.password ||
      url.port
    ) return null;

    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return null;
    if (!/^[A-Za-z0-9_.-]+$/.test(repo.replace(/\.git$/i, ""))) return null;
    return `https://github.com/${owner}`;
  } catch {
    return null;
  }
}
