import { NextResponse } from "next/server";
import { guardedRoute } from "@/lib/guard";
import { reviewRepositoryFor } from "@/lib/reviewEvidence";
import { fetchReadme } from "@/lib/commits";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// The README of a project's repo, as HTML, for the review page's README tab.
// The repo is looked up from the project id, so a caller can't point this at
// an arbitrary URL. GitHub's HTML is its own sanitized rendering; other hosts
// go through our escaping markdown renderer. The client still only ever shows
// it inside a sandboxed iframe.
export const GET = guardedRoute<Ctx>("api.projects.readme", "reviewer", async (access, _req, { params }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid project id" }, { status: 400 });
  const data = await reviewRepositoryFor(access, id);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const readme = await fetchReadme((data as { repo_url: string | null }).repo_url);
  if (readme.error) return NextResponse.json({ error: readme.error });
  const html = readme.kind === "markdown" ? renderMarkdown(readme.content) : readme.content;
  return NextResponse.json({ html, baseHref: readme.baseHref });
});
