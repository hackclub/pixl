import { NextRequest, NextResponse } from "next/server";
import { REVIEW_SORT_COOKIE, isReviewSort } from "@/lib/reviewSort";
import { secureCookies } from "@/lib/session";

// Stamps the request path onto x-pixl-pathname so page guards can record
// which page was viewed in the audit log (Server Components have no other way
// to see the pathname). Always overwritten, so a client can't spoof it. Also
// remembers the review queue's sort tab (see lib/reviewSort.ts).
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pixl-pathname", req.nextUrl.pathname.slice(0, 300));
  const res = NextResponse.next({ request: { headers } });
  // Remember the review queue's sort tab (a UI preference, nothing else) so
  // the queue page can fall back to it when a link has no ?sort=.
  if (req.nextUrl.pathname === "/review") {
    const sort = req.nextUrl.searchParams.get("sort");
    if (isReviewSort(sort)) {
      res.cookies.set(REVIEW_SORT_COOKIE, sort, {
        path: "/review",
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies(),
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
