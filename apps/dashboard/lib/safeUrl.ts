// Centralized guard for rendering a database-controlled URL (repo_url,
// demo_url, ...) as a real <a href>/<img src>/etc. React's JSX escaping only
// protects HTML TEXT content - a plain `<a href={value}>` is NOT sanitized
// against dangerous URL SCHEMES (javascript:, vbscript:, file:, data:, ...)
// the way `dangerouslySetInnerHTML` would need to be. The server now rejects
// those at save time for repo_url/demo_url (see
// apps/server/src/routes/projectUrlSafety.ts), but this is the
// defense-in-depth backstop on the render side - for rows saved before that
// validation existed, or any other database-controlled URL field a reviewer
// page ends up linking.
//
// Returns true only for a plain http(s) link, or a same-app-relative path (no
// scheme at all) - never for javascript:/vbscript:/file:/data:/any other
// scheme.
export function isSafeUrl(url: string | null | undefined): url is string {
  const s = String(url ?? "").trim();
  if (!s) return false;
  try {
    // A base is required to resolve a relative URL ("/foo"); it's otherwise
    // unused - we only look at the resulting protocol.
    const u = new URL(s, "https://pixl.invalid");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
