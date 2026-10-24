import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { bearerMatches } from "@/lib/requestGuards";
import { refreshShipsSnapshotForJob } from "@/lib/eligibility/ships";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    await audit({ action: "cron.ships-snapshot", result: "denied", actorType: "anonymous" }, req);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await refreshShipsSnapshotForJob();
    const { view } = result;
    const snapshot = view.snapshot;
    const failed = result.outcome === "failed" || result.outcome === "skipped_backoff";
    await audit({ action: "cron.ships-snapshot", result: failed ? "error" : "ok", actorType: "service", actorId: "cron" }, req);
    return NextResponse.json(
      {
        ok: !failed,
        outcome: result.outcome,
        error: result.error,
        snapshot: snapshot
          ? {
              fetchedAt: snapshot.fetchedAt,
              ageMs: view.ageMs,
              fresh: view.fresh,
              totalReturned: snapshot.totalReturned,
              pixlCount: snapshot.pixlCount,
              indexedPixlCount: snapshot.byId.size,
              invalidCount: snapshot.invalidCount,
              duplicateCount: snapshot.duplicateCount,
              bytes: snapshot.bytes,
            }
          : null,
        diagnostics: {
          lastAttemptAt: view.lastAttemptAt,
          nextRetryAt: view.nextRetryAt,
          error: view.error,
        },
      },
      { status: failed ? 503 : 200 },
    );
  } catch (e) {
    const error = (e as Error).message;
    await audit({ action: "cron.ships-snapshot", result: "error", actorType: "service", actorId: "cron", meta: { error } }, req);
    return NextResponse.json({ ok: false, error }, { status: 503 });
  }
}
