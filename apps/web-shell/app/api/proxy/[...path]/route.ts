// The token lives in an httpOnly cookie, unreadable by client JS by design
// (see docs/superpowers/specs/2026-08-23-react-migration-design.md's
// addendum) - so Client Components that need to POST/PUT/DELETE against
// apps/server go through this instead of calling it directly. Same trust
// boundary as the old localStorage-token model: a signed-in client could
// already call any apps/server endpoint with its own token, this only
// moves where the token itself lives.
import { NextRequest, NextResponse } from "next/server";
import { config } from "@/app/_generated/config";
import { getToken } from "@/lib/session";

export async function proxyRequest(
  req: NextRequest,
  path: string[],
  token: string | null,
): Promise<NextResponse> {
  if (!token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Build with URL/URLSearchParams rather than string concatenation: each
  // segment is re-encoded on the way in (closing off a `..`-via-%2F path
  // traversal out of /api/), and .set() overwrites rather than duplicates
  // if the caller's own query string already had a `token` key.
  const upstreamUrl = new URL(`${config.urls.server}/api/${path.map(encodeURIComponent).join("/")}`);
  upstreamUrl.search = req.nextUrl.search;
  upstreamUrl.searchParams.set("token", token);
  const url = upstreamUrl.toString();

  const init: RequestInit = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    const contentType = req.headers.get("content-type");
    if (contentType) init.headers = { "content-type": contentType };
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch {
    return NextResponse.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
  }
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: RouteContext) {
  const [{ path }, token] = await Promise.all([ctx.params, getToken()]);
  return proxyRequest(req, path, token);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
