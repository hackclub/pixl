import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { reviewRepositoryFor } from "@/lib/reviewEvidence";
import { fetchCommitDiff } from "@/lib/commits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; sha: string }> };

// One commit's diff for the review page's Commits tab. The repo comes from the
// project id, never from the caller.
export const GET = guardedRoute<Ctx>("api.projects.commitDiff", "reviewer", async (access, _req, { params }) => {
  const { id: rawId, sha } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid project id" }, { status: 400 });
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return NextResponse.json({ error: "invalid commit" }, { status: 400 });
  const data = await reviewRepositoryFor(access, id);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(await fetchCommitDiff((data as { repo_url: string | null }).repo_url, sha));
});
