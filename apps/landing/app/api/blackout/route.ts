import { getBriefing } from "../../_content/blackoutBriefing";

const ORIGIN =
  process.env.OPERATIONS_API_ORIGIN ?? "http://pixl-server.ysws-pixl.svc.cluster.local:3000";
const SLUG = "operation-blackout";

export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang");
  let operation: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${ORIGIN}/api/operations/${SLUG}`, {
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (res.ok) operation = ((await res.json()) as { operation?: Record<string, unknown> }).operation ?? null;
  } catch {
    operation = null;
  }

  const unlocked = operation?.briefingUnlocked === true;
  return Response.json(
    { ok: true, operation, ...(unlocked ? { briefing: getBriefing(lang) } : {}) },
    { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" } },
  );
}
