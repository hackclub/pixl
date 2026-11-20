import { publicGet } from "@/lib/server-api";

// Same-origin proxy for the post-deadline landing results. The browser never
// talks to apps/server directly (CSP connect-src is 'self'), so the landing
// page reads its five totals through here. Public and aggregate-only; the
// server caches the numbers, and the CDN may cache this response briefly.
export const dynamic = "force-dynamic";

interface ResultsPayload {
  ok: boolean;
  users: number;
  projectsCreated: number;
  projectsShipped: number;
  hoursShipped: number;
  rewardsUsd: number;
}

export async function GET() {
  const data = await publicGet<ResultsPayload>("/api/results");
  if (!data?.ok) {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    {
      ok: true,
      users: data.users,
      projectsCreated: data.projectsCreated,
      projectsShipped: data.projectsShipped,
      hoursShipped: data.hoursShipped,
      rewardsUsd: data.rewardsUsd,
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
