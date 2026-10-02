import { db } from "./db";
import { robertEnabled, submitProject, recordOutcome, type JournalEntryInput } from "./robert";
import { reviewPatch, isFraudRangeScore, type IncomingReview } from "./robertOutcome";
import { ownerSlackIds } from "./guard";
import { dmUser } from "./slack";

const DASH_URL = process.env.BASE_URL ?? "https://dash.pixl.hackclub.com";

// Push a first-passed project to Robert. Never throws and never blocks the
// verdict: a failed submission is stored on the row and the reconcile cron
// retries it, so a network blip cannot strand a reviewer mid-verdict.
export async function submitToRobert(projectId: number): Promise<void> {
  if (!robertEnabled()) return;
  const { data: project } = await db
    .from("projects")
    .select("id, name, kind, repo_url, demo_url, hackatime_projects, shipped_at, user_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return;
  const { data: owner } = await db
    .from("users")
    .select("slack_id")
    .eq("id", project.user_id as string)
    .maybeSingle();

  let journal: JournalEntryInput[] = [];
  if (project.kind === "hardware") {
    const { data: journals } = await db
      .from("project_journals")
      .select("title, content, hours, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    journal = (journals ?? []).map((j) => ({
      title: (j.title as string | null) || "Journal entry",
      content: String(j.content ?? ""),
      loggedAt: String(j.created_at),
      hours: j.hours == null ? null : Number(j.hours),
    }));
  }

  const result = await submitProject(
    {
      id: project.id as number,
      name: String(project.name),
      kind: (project.kind as "software" | "hardware") ?? "software",
      codeUrl: (project.repo_url as string | null) ?? null,
      demoUrl: (project.demo_url as string | null) ?? null,
      hackatimeProjects: (project.hackatime_projects as string[] | null) ?? [],
      journal,
      shippedAt: (project.shipped_at as string | null) ?? null,
    },
    { slackId: owner?.slack_id ?? null },
  );

  if (result.ok) {
    await db
      .from("projects")
      .update({
        robert_project_id: result.robertProjectId,
        robert_submitted_at: new Date().toISOString(),
        robert_error: "",
      })
      .eq("id", projectId);
    return;
  }
  console.error("robert submit failed", projectId, result.error);
  await db.from("projects").update({ robert_error: result.error }).eq("id", projectId);
}

// Applies a landed review to one project. Idempotent: the status guard in
// reviewPatch means a repeated delivery (or a cron pass that re-sees an
// already-applied project) just does nothing the second time.
export async function applyReview(
  projectId: number,
  currentStatus: string,
  review: IncomingReview,
): Promise<{ applied: boolean }> {
  const patch = reviewPatch(currentStatus, review);
  if (!patch) return { applied: false };

  const { data: project, error } = await db
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .eq("status", "fraud_review")
    .select("id, name")
    .maybeSingle();
  if (error) {
    console.error("applyReview failed", projectId, error.message);
    return { applied: false };
  }
  if (!project) return { applied: false };

  if (isFraudRangeScore(review.trustScore)) {
    await alertFraudScore(projectId, String(project.name), review.trustScore, review.note);
  }
  return { applied: true };
}

// Robert scored this in its own "Fraud" range (1-4) - still goes to Spot
// check like any other reviewed project (see reviewPatch), but the owners
// should know right away rather than finding out whenever someone happens
// to open Spot check next.
async function alertFraudScore(
  projectId: number,
  projectName: string,
  trustScore: number,
  note: string,
): Promise<void> {
  const text =
    `Robert fraud review: "${projectName}" scored ${trustScore}/10 (Robert's "Fraud" range).\n\n` +
    `Note: ${note || "(no note)"}\n\n` +
    `It's in Spot check now, not auto-rejected: ${DASH_URL}/review/${projectId}`;
  await Promise.all(
    ownerSlackIds().map((id) => dmUser(id, text).catch((e) => console.error("robert fraud alert dm failed", id, e))),
  );
}

// Pixl's own Spot check verdict, written back to Robert so its record
// stays accurate too - skipped entirely when Robert already has a final
// state of its own (rejected_fraud: auto-rejected by score; decided: an
// outcome was already recorded, e.g. directly through Robert's own UI),
// since recording another outcome on either would 409. Never throws, never
// blocks the verdict.
export async function recordRobertOutcome(
  robertProjectId: string | null,
  robertState: string | null,
  status: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  if (!robertEnabled() || !robertProjectId) return;
  if (robertState === "rejected_fraud" || robertState === "decided") return;
  const result = await recordOutcome(robertProjectId, status, reason);
  if (!result.ok) console.error("robert outcome write-back failed", robertProjectId, result.error);
}
