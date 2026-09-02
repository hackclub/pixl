import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { postToChannel } from "@/lib/slack";

export const dynamic = "force-dynamic";

function daysWaiting(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false }, { status: 401 });

  const channel = process.env.REVIEW_ALERT_CHANNEL;
  if (!channel)
    return NextResponse.json({ ok: false, error: "REVIEW_ALERT_CHANNEL is not set" });

  const { data, error } = await db
    .from("projects")
    .select("status, shipped_at, first_pass_at")
    .in("status", ["shipped", "fraud_review", "second_review"])
    .is("archived_at", null)
    .is("rejected_at", null)
    .is("banned_at", null);
  if (error) return NextResponse.json({ ok: false, error: error.message });

  const rows = data ?? [];
  if (rows.length === 0) return NextResponse.json({ ok: true, posted: false, pending: 0 });

  const firstPass = rows.filter((r) => r.status === "shipped").length;
  const fraud = rows.filter((r) => r.status === "fraud_review").length;
  const secondPass = rows.length - firstPass - fraud;
  const oldest = Math.max(
    ...rows.map((r) =>
      daysWaiting(r.status === "shipped" ? r.shipped_at : (r.first_pass_at ?? r.shipped_at)),
    ),
  );
  const base = process.env.BASE_URL || "https://pixl-dash.ridit.space";
  const lines = [
    `:hourglass_flowing_sand: *Pixl review queue*: ${rows.length} project${rows.length === 1 ? "" : "s"} waiting` +
      (secondPass > 0 || fraud > 0
        ? ` (${firstPass} first-pass, ${secondPass} second-pass${fraud > 0 ? `, ${fraud} waiting on fraud` : ""})`
        : "") +
      `.`,
    oldest >= 1 ? `Oldest has been waiting *${oldest} day${oldest === 1 ? "" : "s"}*.` : "",
    base ? `<${base}/review|Open the queue>` : "",
  ].filter(Boolean);

  try {
    await postToChannel(channel, lines.join("\n"));
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
  return NextResponse.json({ ok: true, posted: true, pending: rows.length, oldest });
}
