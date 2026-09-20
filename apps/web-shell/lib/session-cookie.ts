// apps/web-shell/lib/session-cookie.ts
// Split out from lib/session.ts so proxy.ts (which only needs this string
// constant) doesn't transitively import next/headers's cookies() - an API
// that's irrelevant to where proxy.ts runs and has no reason to be pulled
// in just to read a constant.
export const SESSION_COOKIE = "pixl_session";

// Set by app/api/login/route.ts right before it sends the browser off to
// apps/server's OAuth flow, and checked by proxy.ts when the flow lands back
// with ?token= - see both for why (F-8: a bare ?token= on any page must not
// be enough to establish a session).
export const LOGIN_NONCE_COOKIE = "pixl_login_nonce";
