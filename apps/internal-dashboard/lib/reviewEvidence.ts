import { db, firstPassAccess } from "@/lib/db";
import { canReadReviewEvidence } from "@/lib/reviewAccess";
import type { AdminAccess } from "@/lib/roles";

// Read the project and authorize its repository evidence as one operation.
// This intentionally mirrors app/review/[id]/page.tsx instead of relying on
// reviewer-role authorization alone.
export async function reviewRepositoryFor(access: AdminAccess, projectId: number): Promise<{ repo_url: string | null } | null> {
  const { data, error } = await db
    .from("projects")
    .select("repo_url, kind, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data || !canReadReviewEvidence(access, data)) return null;
  if (data.status === "shipped" && !access.canOpenFullQueue) {
    const gate = await firstPassAccess(projectId, access.session.slackId, false);
    if (!gate.ok) return null;
  }
  return { repo_url: data.repo_url as string | null };
}
