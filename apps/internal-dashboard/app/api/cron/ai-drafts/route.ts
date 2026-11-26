import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/requestGuards";
import { db, listShippedProjects } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateAiReviewDraft } from "@/lib/aiReview";
import { buildAiReviewInput } from "@/lib/aiReviewRun";
import { AI_DRAFT_BY, mayWriteAiDraft } from "@/lib/aiDraftBatch";

export const dynamic = "force-dynamic";

// Run by hand, not on a schedule: GET /api/cron/ai-drafts?limit=30&overwrite=1
// with the CRON_SECRET bearer. Pre-fills the "Technical features" box of the
// first `limit` projects in the first-pass queue (longest wait first) with the
// AI draft, so a reviewer opens a project with the write-up already there.
//
// It builds exactly the prompt the "Generate AI draft" button builds
// (buildAiReviewInput + generateAiReviewDraft) and keeps only technicalFeatures
// from the answer: the notes, deflation reason and flags it also returns are
// dropped. The text goes into the shared review draft (projects.review_draft),
// which the review form restores. A draft a reviewer already wrote is never
// touched; a draft this job wrote earlier is replaced only with overwrite=1.
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;
const CONCURRENCY = 3;
const MIN_TEXT = 200;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    await audit({ action: "cron.ai-drafts", result: "denied", actorType: "anonymous" }, req);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("limit"))) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const overwrite = url.searchParams.get("overwrite") === "1";
  await audit(
    { action: "cron.ai-drafts", result: "ok", actorType: "service", actorId: "cron", meta: { limit, overwrite } },
    req,
  );

  // `limit` counts projects that can still take a draft, not queue positions,
  // so the ones already drafted don't use up the budget.
  const waiting = (await listShippedProjects(undefined, undefined, { includeClaimed: true })).map((p) => Number(p.id));
  const { data: states } = await db.from("projects").select("id, review_draft, review_draft_by").in("id", waiting);
  const stateOf = new Map((states ?? []).map((s) => [Number(s.id), s]));
  const queue = waiting
    .filter((id) => {
      const s = stateOf.get(id);
      return !!s && mayWriteAiDraft(s, overwrite);
    })
    .slice(0, limit);
  const saved: number[] = [];
  const skipped: number[] = [];
  const failed: { id: number; error: string }[] = [];
  // Projects whose own text looks aimed at an AI (see lib/aiPromptSafety.ts).
  const suspicious: number[] = [];

  const work = async (id: number) => {
    try {
      const { data: cur } = await db
        .from("projects")
        .select("review_draft, review_draft_by")
        .eq("id", id)
        .single();
      if (!cur || !mayWriteAiDraft(cur, overwrite)) {
        skipped.push(id);
        return;
      }
      const draft = await generateAiReviewDraft(await buildAiReviewInput(id));
      // Never pre-fill a write-up the model may have been steered into: it would
      // sit in the reviewer's box without the flag. The reviewer can still press
      // "Generate AI draft", which shows the flag first.
      if (draft.injectionSignals.length > 0) {
        suspicious.push(id);
        await audit(
          {
            action: "cron.ai-drafts.suspicious",
            result: "ok",
            actorType: "service",
            actorId: "cron",
            meta: { projectId: id, signals: draft.injectionSignals.length },
          },
          req,
        );
        return;
      }
      const text = draft.technicalFeatures.trim();
      if (text.length < MIN_TEXT) throw new Error(`draft too short (${text.length})`);
      // Guarded on the draft owner still being the one we read, so a reviewer
      // who started typing in the meantime is never overwritten.
      const { data: written } = await db
        .from("projects")
        .update({
          review_draft: { technicalFeatures: text },
          review_draft_by: AI_DRAFT_BY,
          review_draft_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("review_draft_by", (cur.review_draft_by as string | null) ?? "")
        .select("id");
      if (!written || written.length === 0) skipped.push(id);
      else saved.push(id);
    } catch (e) {
      failed.push({ id, error: (e as Error).message.slice(0, 200) });
    }
  };

  const pool = [...queue];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (pool.length > 0) await work(pool.shift() as number);
    }),
  );

  return NextResponse.json({ ok: true, processed: queue.length, saved, skipped, suspicious, failed });
}
