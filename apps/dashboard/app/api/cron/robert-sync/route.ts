import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchScoredProjects, robertEnabled, robertExternalId } from "@/lib/robert";
import { applyReview, submitToRobert } from "@/lib/robertSync";

export const dynamic = "force-dynamic";

// The primary way a 5-10 score ever reaches Spot check: Robert only webhooks
// on a final outcome, and we deliberately never record one ourselves until
// Spot check decides, so a score in that range just sits in awaiting_outcome
// with no webhook at all. This polls for it, also retries any submission
// that failed, and doubles as the safety net for a lost auto-fraud-reject
// webhook delivery (Robert's webhooks aren't retried indefinitely either).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false }, { status: 401 });
  if (!robertEnabled()) return NextResponse.json({ ok: true, skipped: "robert is not configured" });

  const { data: waiting, error } = await db
    .from("projects")
    .select("id, robert_project_id, status, shipped_at")
    .eq("status", "fraud_review")
    .limit(500);
  if (error) return NextResponse.json({ ok: false, error: error.message });

  const rows = (waiting ?? []) as {
    id: number;
    robert_project_id: string | null;
    status: string;
    shipped_at: string | null;
  }[];

  let resubmitted = 0;
  for (const row of rows) {
    if (row.robert_project_id) continue;
    await submitToRobert(row.id);
    resubmitted += 1;
  }

  const known = rows.filter((r) => r.robert_project_id);
  let applied = 0;
  if (known.length > 0) {
    const scored = await fetchScoredProjects();
    // Matched by externalId (our own "pixl-<id>-<shippedAtSeconds>" scheme)
    // rather than robert_project_id, since that's what Robert's list
    // response actually carries per project - robert_project_id on our row
    // is just the same value we stored back after submitting.
    const byExternalId = new Map(scored.map((p) => [p.externalId, p]));
    for (const row of known) {
      const remote = byExternalId.get(robertExternalId(row.id, row.shipped_at));
      if (!remote?.review) continue;
      const result = await applyReview(row.id, row.status, {
        trustScore: remote.review.trustScore,
        note: remote.review.note,
        reviewedAt: remote.review.at,
        robertState: remote.state,
      });
      if (result.applied) applied += 1;
    }
  }

  return NextResponse.json({ ok: true, waiting: rows.length, resubmitted, applied });
}
