import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { applyReview } from "@/lib/robertSync";

export const dynamic = "force-dynamic";

const TOLERANCE_SECONDS = 300;

// Per Robert's docs: sha256= + hex HMAC-SHA256 of "<timestamp>.<raw body>",
// keyed by the whsec_ secret issued when the webhook URL was set. Computed
// over the raw bytes, compared in constant time, and a timestamp more than
// 5 minutes off is rejected so a captured request can't be replayed later.
function verifyRobertWebhook(secret: string, timestamp: string | null, signature: string | null, rawBody: string): boolean {
  if (!timestamp || !signature) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Robert posts here whenever a project reaches its final outcome: either an
// organizer (us, via Spot check's write-back - see recordRobertOutcome) or
// Robert's own fraud reviewer scoring it 4 or below, which is final on
// Robert's own side with no organizer decision. Only that second case
// (status "rejected" while our row is still fraud_review) actually moves
// anything here - a delivery confirming our own write-back lands on a
// project that already advanced past fraud_review, so applyReview's status
// guard makes it a no-op. Robert does NOT webhook when a score lands in the
// 5-10 range (state just becomes awaiting_outcome with no outcome yet), so
// that case is caught by the reconcile cron instead (app/api/cron/robert-sync).
export async function POST(req: Request) {
  const secret = process.env.ROBERT_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json({ ok: false, error: "ROBERT_WEBHOOK_SECRET is not set" }, { status: 500 });

  const rawBody = await req.text();
  if (
    !verifyRobertWebhook(
      secret,
      req.headers.get("x-robert-timestamp"),
      req.headers.get("x-robert-signature"),
      rawBody,
    )
  )
    return NextResponse.json({ ok: false }, { status: 401 });

  let body: {
    event?: string;
    projectId?: string;
    outcome?: {
      status?: string;
      reason?: string | null;
      trustScore?: number | null;
      reviewedAt?: string | null;
    };
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (body.event === "ping") return NextResponse.json({ ok: true });
  if (body.event !== "outcome.set") return NextResponse.json({ ok: true, ignored: true });

  const robertProjectId = String(body.projectId ?? "").trim();
  const trustScore = body.outcome?.trustScore;
  if (!robertProjectId || trustScore == null)
    return NextResponse.json({ ok: false, error: "missing projectId or outcome.trustScore" }, { status: 400 });

  const { data: project } = await db
    .from("projects")
    .select("id, status")
    .eq("robert_project_id", robertProjectId)
    .maybeSingle();
  if (!project) {
    console.error("robert webhook for unknown project", robertProjectId);
    return NextResponse.json({ ok: true, unknown: true });
  }

  const result = await applyReview(project.id as number, String(project.status), {
    trustScore: Number(trustScore),
    note: body.outcome?.reason ?? "",
    reviewedAt: body.outcome?.reviewedAt ?? new Date().toISOString(),
    robertState: body.outcome?.status === "rejected" ? "rejected_fraud" : "decided",
  });

  return NextResponse.json({ ok: true, ...result });
}
