// Ported from pixl.js: on the standalone play.* host the game is at the
// root; proxied under pixl.hackclub.com (via apps/landing's rewrites) it
// lives at /play. This runs server-side (Server Components have no
// `location`), so it takes the request host explicitly instead of reading
// it off `location.hostname`.
export function gameUrl(host: string): string {
  return host.startsWith("play.") ? "/" : "/play";
}

// Hack Club Auth login entry point for a signed-out shell page. Routed
// through this app's own /api/login (not straight to apps/server) so that
// route can drop a same-origin login nonce cookie before the browser ever
// leaves - see its own comment, and proxy.ts, for why (F-8: a bare ?token=
// arriving on any page must not be enough to establish a session).
//
// `back` has to be absolute and on a host apps/server allows
// (ALLOWED_REDIRECT_HOSTS in routes/auth.ts) or the whole login 400s.
export function loginUrl(back: string): string {
  return `/api/login?back=${encodeURIComponent(back)}`;
}

// Absolute URL of the current request. The request's own scheme can't be
// trusted: apps/landing reaches this app over a plain-HTTP internal cluster
// hop, so it reads "http:" even in prod. NODE_ENV is the same signal
// proxy.ts keys the cookie's secure flag off, for the same reason.
export function currentUrl(host: string, pathAndQuery: string): string {
  const scheme = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${scheme}://${host}${pathAndQuery}`;
}
