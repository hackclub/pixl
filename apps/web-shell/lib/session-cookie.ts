// apps/web-shell/lib/session-cookie.ts
// Split out from lib/session.ts so proxy.ts (which only needs this string
// constant) doesn't transitively import next/headers's cookies() - an API
// that's irrelevant to where proxy.ts runs and has no reason to be pulled
// in just to read a constant.
export const SESSION_COOKIE = "pixl_session";
