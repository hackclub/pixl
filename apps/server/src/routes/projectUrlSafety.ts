// Centralized normalization for player-entered project links (repo_url,
// demo_url). Extracted so it's independently unit-testable (see
// projectUrlSafety.test.ts) and has one place to fix if another dangerous
// scheme trick shows up later.
//
// Security context: a draft project (never shipped) is exposed read-only,
// with no auth required, through GET /api/explore/projects (see
// routes/explore.ts, "Browse everyone's projects, including drafts" - no
// status filter unless the caller asks for one). Every renderer that shows
// repo_url/demo_url - the game's project pages, and the dashboard's React
// review/detail pages - puts the raw value straight into <a href=...>.
// Neither Pixl.esc() (HTML-escaping) nor React's JSX text escaping stops a
// javascript: (or vbscript:/file:/data:) URL from executing when a visitor
// clicks the link - HTML-escaping a value doesn't validate what scheme it
// is. So a draft's repo_url/demo_url must never be allowed to keep a
// dangerous scheme, even though real ship-time validation (isGitRepoUrl in
// gitRepoUrl.ts / normalizeDemoUrl further down projects.ts) only ever runs
// once a project
// is actually shipped.
//
// The previous implementation only checked for a "scheme://" shape before
// trusting the scheme outright, which is exactly what let a
// "javascript://...", "vbscript://...", or "file://..." link survive a draft
// save unmodified.
export type ProjectUrlResult = { ok: true; url: string } | { ok: false };

const MAX_URL_LENGTH = 500;
// Demo links get a far higher cap: strudel.cc (and similar) encode the whole
// piece in the URL, so a perfectly normal demo link runs to thousands of chars.
export const MAX_DEMO_URL_LENGTH = 10000;

// Players routinely paste a link without a scheme ("foo.itch.io/game") - this
// must still normalize to "https://foo.itch.io/game" so the ship-time
// liveness check (fetch(url)) doesn't reject it as unreachable, and so a
// perfectly ordinary partial/garbage placeholder someone is still typing
// ("coming soon") doesn't error out an autosave. Detecting "already has a
// scheme" only on a literal "scheme://" (not just "scheme:") preserves that
// exact behavior for inputs like "example.com:8080/path" or
// "localhost:3000/game", which contain a colon but no scheme - critical
// detail: prepending https:// to those must keep working exactly as before.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeProjectUrl(raw: unknown, maxLength = MAX_URL_LENGTH): ProjectUrlResult {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, url: "" };

  if (!HAS_SCHEME.test(s)) {
    // No scheme at all - always safe to prepend https://, since whatever
    // follows can never be interpreted as a different scheme by the browser.
    return { ok: true, url: `https://${s}`.slice(0, maxLength) };
  }

  // Already looks like scheme://... - the one case that can carry a
  // dangerous scheme (javascript://, vbscript://, file://, data://, or any
  // other custom/unknown scheme). Parse it for real and require http(s).
  // Returns the original string, not u.toString() - re-serializing a URL
  // object normalizes it (e.g. adds a trailing slash to a bare origin),
  // which would needlessly change what gets stored for input that was
  // already fine.
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false };
  return { ok: true, url: s.slice(0, maxLength) };
}
