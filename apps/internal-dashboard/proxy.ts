import { NextRequest, NextResponse } from "next/server";

// Cheap, per-process fallback. The Orchard ingress shield remains necessary
// for floods that are too large to let reach Next.js at all.
export function createFixedWindowLimiter(limit: number, windowMs: number) {
  let window = -1;
  let count = 0;
  return (now: number = Date.now()): boolean => {
    const nextWindow = Math.floor(now / windowMs);
    if (nextWindow !== window) {
      window = nextWindow;
      count = 0;
    }
    if (count >= limit) return false;
    count += 1;
    return true;
  };
}

const allowOAuthCallback = createFixedWindowLimiter(20, 1000);
const OAUTH_STATE_RE = /^[a-f0-9]{32}$/i;

// Stamps the request path onto x-pixl-pathname so page guards can record
// which page was viewed in the audit log. Always overwritten so the client
// cannot spoof it.
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/auth/callback") {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const savedState = req.cookies.get("pixl_oauth_state")?.value;

    // Reject malformed or obviously forged callbacks before the route handler
    // attempts any database audit write or external OAuth request.
    if (!code || code.length > 2000 || !state || !OAUTH_STATE_RE.test(state) ||
        !savedState || savedState !== state) {
      return new NextResponse(null, {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }

    if (!allowOAuthCallback()) {
      return new NextResponse(null, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": "2" },
      });
    }
  }

  const headers = new Headers(req.headers);
  headers.set("x-pixl-pathname", req.nextUrl.pathname.slice(0, 300));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
