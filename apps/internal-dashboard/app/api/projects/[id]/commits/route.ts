import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { reviewRepositoryFor } from "@/lib/reviewEvidence";
import { fetchCommits } from "@/lib/commits";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Reviewer endpoint to fetch commits for a project (100 per page).
export const GET = guardedRoute<Ctx>("api.projects.commits", "reviewer", async (access, req, { params }) => {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid project id" }, { status: 400 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const data = await reviewRepositoryFor(access, id);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await fetchCommits((data as { repo_url: string | null }).repo_url, 100, page);
  return NextResponse.json(result);
});
