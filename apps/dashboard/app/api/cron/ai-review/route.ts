import { NextResponse } from "next/server";
import { analyzeRepository, type AiReviewFindings } from "@/lib/aiReview";
import { db } from "@/lib/db";
import { aiReviewCompletionPatch } from "@/lib/aiReviewQueue";
import { fetchRepositorySnapshot } from "@/lib/repositorySnapshot";

export const dynamic = "force-dynamic";

type QueueRow = {
  readonly id: number;
  readonly status: string;
  readonly ai_review_status: string | null;
  readonly ai_review_started_at: string | null;
  readonly repo_url: string | null;
  readonly name: string;
  readonly description: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQueueRow(value: unknown): value is QueueRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.status === "string" &&
    (typeof value.ai_review_status === "string" || value.ai_review_status === null) &&
    (typeof value.ai_review_started_at === "string" || value.ai_review_started_at === null) &&
    (typeof value.repo_url === "string" || value.repo_url === null) &&
    typeof value.name === "string" &&
    (typeof value.description === "string" || value.description === null)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "AI pre-screen failed";
}

function isStale(row: QueueRow): boolean {
  return Boolean(
    row.ai_review_status === "running" &&
      row.ai_review_started_at &&
      Date.now() - new Date(row.ai_review_started_at).getTime() > 10 * 60_000,
  );
}

async function releaseDisabled(rows: readonly QueueRow[]): Promise<number> {
  let released = 0;
  for (const row of rows) {
    const { error } = await db
      .from("projects")
      .update({ status: "shipped", ai_review_status: "disabled", ai_review_started_at: null })
      .eq("id", row.id)
      .eq("status", "ai_review");
    if (!error) released += 1;
  }
  return released;
}

async function failOpen(projectId: number, message: string): Promise<void> {
  await db
    .from("projects")
    .update({
      status: "shipped",
      ai_review_status: "failed",
      ai_review_score: null,
      ai_review_summary: "",
      ai_review_findings: { strengths: [], findings: [] },
      ai_review_error: message,
      ai_review_started_at: null,
      ai_reviewed_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("status", "ai_review")
    .eq("ai_review_status", "running");
}

async function scan(row: QueueRow): Promise<"completed" | "failed" | "skipped"> {
  if (row.ai_review_status === "running" && !isStale(row)) return "skipped";
  if (isStale(row)) {
    await db
      .from("projects")
      .update({ ai_review_status: "pending", ai_review_started_at: null })
      .eq("id", row.id)
      .eq("status", "ai_review")
      .eq("ai_review_status", "running");
  }
  const { data: claimed } = await db
    .from("projects")
    .update({ ai_review_status: "running", ai_review_started_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "ai_review")
    .eq("ai_review_status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return "skipped";

  try {
    const snapshot = await fetchRepositorySnapshot(row.repo_url);
    const result = await analyzeRepository({ projectName: row.name, description: row.description, snapshot });
    const findings: AiReviewFindings = { strengths: result.strengths, findings: result.findings };
    const { error } = await db
      .from("projects")
      .update({
        ...aiReviewCompletionPatch(result.score),
        ai_review_summary: result.summary,
        ai_review_findings: findings,
        ai_review_error: "",
        ai_review_started_at: null,
        ai_reviewed_at: new Date().toISOString(),
        ai_review_model: result.model,
        ai_review_revision: result.revision,
        ai_review_files_seen: result.filesSeen,
        ai_review_files_omitted: result.filesOmitted,
      })
      .eq("id", row.id)
      .eq("status", "ai_review")
      .eq("ai_review_status", "running");
    if (error) {
      await failOpen(row.id, error.message.slice(0, 500));
      return "failed";
    }
    return "completed";
  } catch (error) {
    await failOpen(row.id, errorMessage(error));
    return "failed";
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ ok: false }, { status: 401 });

  const { data, error } = await db
    .from("projects")
    .select("id, status, ai_review_status, ai_review_started_at, repo_url, name, description")
    .eq("status", "ai_review")
    .limit(5);
  if (error) return NextResponse.json({ ok: false, error: error.message });
  const rows = (data ?? []).filter(isQueueRow);
  if (process.env.AI_REVIEW_ENABLED !== "true") {
    const released = await releaseDisabled(rows);
    return NextResponse.json({ ok: true, skipped: "AI_REVIEW_ENABLED is not true", released });
  }
  const results: Array<"completed" | "failed" | "skipped"> = [];
  for (const row of rows) results.push(await scan(row));
  return NextResponse.json({
    ok: true,
    waiting: rows.length,
    completed: results.filter((result) => result === "completed").length,
    failed: results.filter((result) => result === "failed").length,
    skipped: results.filter((result) => result === "skipped").length,
  });
}
