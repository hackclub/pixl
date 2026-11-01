import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { bearerMatches } from "@/lib/requestGuards";
import { refreshAirbridgeCache } from "@/lib/eligibility/airbridgeCache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scheduler-only endpoint; no unauthenticated refresh or browser activity. */
export async function GET(req: Request) {
  if (process.env.FULFILLMENT_SHIPS_SOURCE !== "airbridge")
    return NextResponse.json({ ok: false, error: "Airbridge provider disabled" }, { status: 409 });
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Cron secret not configured" }, { status: 503 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    await audit({ action: "cron.airbridge-fulfillment", result: "denied", actorType: "anonymous" }, req);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await refreshAirbridgeCache(60);
    const ok = result.errors === 0;
    await audit({ action: "cron.airbridge-fulfillment", result: ok ? "ok" : "error",
      actorType: "service", actorId: "cron", meta: result }, req);
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503 });
  } catch (e) {
    const error = (e as Error).message;
    await audit({ action: "cron.airbridge-fulfillment", result: "error",
      actorType: "service", actorId: "cron", meta: { error } }, req);
    return NextResponse.json({ ok: false, error }, { status: 503 });
  }
}
