// Ported from pixl.js: on the standalone play.* host the game is at the
// root; proxied under pixl.hackclub.com (via apps/landing's rewrites) it
// lives at /play. This runs server-side (Server Components have no
// `location`), so it takes the request host explicitly instead of reading
// it off `location.hostname`.
export function gameUrl(host: string): string {
  return host.startsWith("play.") ? "/" : "/play";
}

// Hack Club Auth login, the same entry point the Godot client and the old
// static shell used (pixl.js's loginUrl). apps/server finishes the OAuth
// dance and redirects back to `back` with ?token= on the end, which
// proxy.ts turns into the pixl_session cookie. So a signed-out visitor can
// log in from a shell page directly, without opening the game first.
//
// `back` has to be absolute and on a host apps/server allows
// (ALLOWED_REDIRECT_HOSTS in routes/auth.ts) or the whole login 400s.
export function loginUrl(server: string, back: string): string {
  return `${server}/auth/hackclub?web_redirect=${encodeURIComponent(back)}`;
}

// Absolute URL of the current request. The request's own scheme can't be
// trusted: apps/landing reaches this app over a plain-HTTP internal cluster
// hop, so it reads "http:" even in prod. NODE_ENV is the same signal
// proxy.ts keys the cookie's secure flag off, for the same reason.
export function currentUrl(host: string, pathAndQuery: string): string {
  const scheme = process.env.NODE_ENV === "production" ? "https" : "http";
  return `${scheme}://${host}${pathAndQuery}`;
}
