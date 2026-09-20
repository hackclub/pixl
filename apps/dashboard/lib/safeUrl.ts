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

// Guard for server-action "go back" targets (returnTo/back/backTo hidden form
// fields in apps/dashboard/app/actions.ts). Those values are fully
// caller-controlled - redirect() follows absolute URLs, so passing one
// through unchecked is an open redirect. Only a same-app path is ever a
// legitimate value here; anything else (absolute URL, protocol-relative
// "//evil", backslashes, CR/LF) falls back instead of redirecting outward.
export function safeRedirectPath(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  if (/[\\]/.test(s)) return fallback;
  if (/[\r\n\u2028\u2029]/.test(s)) return fallback;
  try {
    const u = new URL(s, "https://pixl.invalid");
    // A scheme/host smuggled in any form resolves off the base origin.
    if (u.origin !== "https://pixl.invalid") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
