import { NextRequest, NextResponse } from "next/server";
import { LOGIN_NONCE_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";

// 14 days - matches apps/server/src/auth/session.ts's issueSessionToken
// expiry, so the cookie never outlives the JWT it holds.
const MAX_AGE = 60 * 60 * 24 * 14;

export function proxy(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    // The signed-out gate builds a Hack Club Auth return url, and a Server
    // Component can't see the path on its own. Forwarding it keeps the
    // no-JS render pointing back at the page the visitor actually asked for.
    const headers = new Headers(req.headers);
    headers.set("x-pixl-path", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  }

  const url = req.nextUrl.clone();
  url.searchParams.delete("token");
  url.searchParams.delete("name");
  url.searchParams.delete("ln");
  const res = NextResponse.redirect(url);

  // F-8: a bare ?token= on an arbitrary page is not proof this browser just
  // finished a real login - anyone who has any valid token at all (e.g.
  // their own, from logging in normally) could otherwise mail a victim a
  // link like /dashboard?token=<their token> and silently sign the
  // victim's browser into the attacker's own account. app/api/login/route.ts
  // is the only place a login starts; it drops this cookie on this same
  // origin before ever sending the browser to apps/server, and the same
  // value comes back as ?ln= only via the real OAuth round trip (see
  // routes/auth.ts's pendingLogins). Deleted either way so a captured/
  // replayed URL (browser history, a referrer log) can't be replayed once
  // the real login has gone through.
  const expectedNonce = req.cookies.get(LOGIN_NONCE_COOKIE)?.value;
  const suppliedNonce = req.nextUrl.searchParams.get("ln");
  const nonceOk = !!expectedNonce && !!suppliedNonce && expectedNonce === suppliedNonce;
  res.cookies.delete(LOGIN_NONCE_COOKIE);
  if (!nonceOk) return res;

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // req.nextUrl.protocol would read "http:" even in prod - apps/landing
    // reaches this app over a plain-HTTP internal cluster hop, so the
    // request's own scheme lies about whether the original client was on
    // HTTPS. NODE_ENV is the one signal this app actually has that's true
    // only in the real deployment (Dockerfile sets it explicitly).
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
