import { NextRequest, NextResponse } from "next/server";

// Stamps the request path onto x-pixl-pathname so page guards can record
// which page was viewed in the audit log (Server Components have no other way
// to see the pathname). Always overwritten, so a client can't spoof it.
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pixl-pathname", req.nextUrl.pathname.slice(0, 300));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
