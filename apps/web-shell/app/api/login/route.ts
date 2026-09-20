import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { config } from "@/app/_generated/config";
import { LOGIN_NONCE_COOKIE } from "@/lib/session-cookie";

// F-8: apps/server's /auth/hackclub finishes by redirecting the browser
// straight back to whichever page login started from with ?token= on the
// end (proxy.ts turns that into the session cookie) - there's no single
// fixed callback route to lock ?token= handling down to, since Hack Club
// Auth always returns to wherever the flow started. Without something
// tying that ?token= to a login THIS browser actually started, anyone who
// has any valid token at all (e.g. their own, from logging in normally)
// could mail a link like /dashboard?token=<their token> to a victim and
// silently sign the victim's browser into the attacker's own account
// (session fixation / login CSRF).
//
// This route is now the only place a login starts. It drops a random,
// short-lived, single-use nonce as an httpOnly cookie on THIS origin
// before the browser ever leaves for apps/server, and passes the same
// value through as ?nonce= so apps/server can thread it through its OAuth
// `state` round trip (see routes/auth.ts's pendingLogins) and hand it back
// as ?ln= on the final redirect. proxy.ts only honours ?token= when ?ln=
// matches this cookie - a link with just ?token= and no matching cookie in
// the victim's own browser is inert.
const NONCE_TTL_SECONDS = 10 * 60;

export async function GET(req: NextRequest) {
  const back = req.nextUrl.searchParams.get("back") ?? "";
  const nonce = crypto.randomBytes(16).toString("hex");

  const url = new URL("/auth/hackclub", config.urls.server);
  url.searchParams.set("web_redirect", back);
  url.searchParams.set("nonce", nonce);

  const res = NextResponse.redirect(url);
  res.cookies.set(LOGIN_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: NONCE_TTL_SECONDS,
    path: "/",
  });
  return res;
}
