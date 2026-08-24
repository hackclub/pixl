// Ported from pixl.js: on the standalone play.* host the game is at the
// root; proxied under pixl.hackclub.com (via apps/landing's rewrites) it
// lives at /play. This runs server-side (Server Components have no
// `location`), so it takes the request host explicitly instead of reading
// it off `location.hostname`.
export function gameUrl(host: string): string {
  return host.startsWith("play.") ? "/" : "/play";
}
