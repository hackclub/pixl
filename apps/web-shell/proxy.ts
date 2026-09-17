import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

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
  const res = NextResponse.redirect(url);
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
