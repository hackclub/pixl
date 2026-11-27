// Runs the AI pre-check on a project that was just shipped. The ship route
// marks the project ai_review_status = "pending" (with ai_review_started_at
// as this run's token) and calls runPrecheck without awaiting it. While a
// fresh run is pending the dashboard keeps the project out of the review queue
// (see isPrecheckRunning in apps/internal-dashboard/lib/precheck.ts); after
// PRECHECK_HIDE_MS it shows up regardless, so a crashed or hung run can only
// ever delay a project, never lose it.
//
// Outcomes, written back onto the project row:
// - "sent_back": a clear-cut miss (rules.ts BLOCKING) on a first ship that
//   the AI hasn't sent back before. Status becomes needs_changes, the player
//   gets a notification and a Pixo DM, and it's logged to review_audits,
//   mod_actions and audit_log.
// - "flagged": misses found, but it's an update or the AI already sent it
//   back once - a human decides, with the findings shown on the review page.
// - "clear": nothing missing. Notes still go to the reviewer.
// - "error": something broke; the project goes to the queue as normal.

import { db } from "../db/client.js";
import { audit } from "../audit.js";
import { config, submissionDeadline } from "../config.generated.js";
import { callPixo } from "../pixoCall.js";
import { externalDmUrl } from "../pixoUrl.js";
import { escapeMrkdwn } from "../slackEscape.js";
import { addNotification } from "../routes/notifications.js";
import {
  BLOCKING,
  dmFor,
  evaluate,
  findReadme,
  parseGithubRepo,
  requirementsFor,
  reviewNoteFor,
  type PrecheckFindings,
  type ProjectKind,
} from "./rules.js";
import { PRECHECK_MODEL, askModel, fetchRawFile, fetchRepoFiles } from "./sources.js";

// The AI may send a project back this many times; after that, re-ships go to
// a human with the findings attached (a wrong flag costs one round trip max).
export const MAX_AUTO_SENDBACKS = 1;
export const REVIEWER_LABEL = "Pixl auto-check";
const AUDIT_REVIEWER = "Pixl auto-check (ai-precheck)";

// Kill switch: AI_PRECHECK=off ships straight to the queue like before.
export function precheckEnabled(): boolean {
  return (process.env.AI_PRECHECK ?? "").toLowerCase() !== "off";
}

export function shouldPrecheck(repoUrl: string | null | undefined): boolean {
  return precheckEnabled() && !!repoUrl && parseGithubRepo(repoUrl) !== null;
}

interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  kind: string | null;
  finished_build: boolean | null;
  bom_url: string | null;
  repo_url: string | null;
  user_id: string;
  status: string;
  is_update: boolean | null;
  shipped_at: string | null;
  hackatime_seconds: number | null;
  ai_review_status: string;
  ai_review_started_at: string | null;
  ai_precheck_sendbacks: number | null;
  reviewing_by: string | null;
}

function findingsJson(f: PrecheckFindings, sentBack: boolean) {
  return {
    findings: f.blocking.map((id) => ({ id, label: BLOCKING[id], evidence: f.evidence[id as keyof typeof f.evidence] ?? "" })),
    notes: f.notes,
    skipped: f.skipped,
    sentBack,
    strengths: [],
  };
}

async function dmOwner(userId: string, text: string): Promise<void> {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key) return;
  const { data } = await db.from("users").select("slack_id").eq("id", userId).maybeSingle();
  const slackId = String((data as { slack_id?: string } | null)?.slack_id ?? "");
  if (!/^[UW][A-Z0-9]{5,20}$/.test(slackId)) return;
  // Never throws; a stopped Pixo is logged and audited by callPixo.
  await callPixo("precheck.dm", externalDmUrl(), {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: slackId, message: text }),
  });
}

export async function runPrecheck(projectId: number, startedAt: string): Promise<void> {
  // Every write below is conditional on this exact run still being the
  // pending one, so an unship/re-ship mid-check can't be overwritten.
  const finish = (patch: Record<string, unknown>) =>
    db
      .from("projects")
      .update({ ...patch, ai_reviewed_at: new Date().toISOString(), ai_review_model: PRECHECK_MODEL })
      .eq("id", projectId)
      .eq("status", "shipped")
      .eq("ai_review_status", "pending")
      .eq("ai_review_started_at", startedAt)
      .select("id")
      .maybeSingle();

  try {
    const { data } = await db
      .from("projects")
      .select(
        "id, name, description, kind, finished_build, bom_url, repo_url, user_id, status, is_update, shipped_at, hackatime_seconds, ai_review_status, ai_review_started_at, ai_precheck_sendbacks, reviewing_by",
      )
      .eq("id", projectId)
      .maybeSingle();
    const p = data as ProjectRow | null;
    if (!p || p.status !== "shipped" || p.ai_review_status !== "pending") return;
    if (!p.ai_review_started_at || new Date(p.ai_review_started_at).getTime() !== new Date(startedAt).getTime()) return;
    const ref = parseGithubRepo(p.repo_url ?? "");
    if (!ref) {
      await finish({ ai_review_status: "error", ai_review_error: "not a GitHub repo" });
      return;
    }

    const kind: ProjectKind = p.kind === "hardware" ? "hardware" : "software";
    const files = await fetchRepoFiles(ref);
    const readmeName = files ? findReadme(files) : "README.md";
    const readme = readmeName ? await fetchRawFile(ref, readmeName) : null;
    const asked = requirementsFor(kind, !!p.finished_build);
    const ai = readme
      ? await askModel({ kind, name: p.name, description: p.description ?? "", readme, files, asked })
      : null;
    const findings = evaluate({ kind, readme, files, bomUrl: p.bom_url, ai, asked });

    const sendbacks = Number(p.ai_precheck_sendbacks) || 0;
    // Someone already opened it from a direct link: leave it to them.
    const humanOnIt = !!p.reviewing_by;
    // The one post-deadline resubmit is judged by a human: another request for
    // changes on it is a final rejection, which the AI must not hand out.
    const finalResubmit = !!p.shipped_at && new Date(p.shipped_at) > submissionDeadline;
    const sendBack =
      findings.blocking.length > 0 && !p.is_update && sendbacks < MAX_AUTO_SENDBACKS && !humanOnIt && !finalResubmit;
    const common = {
      ai_review_summary: findings.summary,
      ai_review_findings: findingsJson(findings, sendBack),
      ai_review_error: findings.skipped.join("; ").slice(0, 500),
    };
    const meta = { blocking: findings.blocking, skipped: findings.skipped, model: PRECHECK_MODEL };

    if (!sendBack) {
      const status = findings.blocking.length > 0 ? "flagged" : "clear";
      await finish({ ...common, ai_review_status: status });
      audit({ actorType: "service", actorId: "ai-precheck", action: `precheck.${status}`, target: `project:${projectId}`, result: "ok", meta });
      return;
    }

    const note = reviewNoteFor(findings.blocking);
    const { data: claimed } = await finish({
      ...common,
      ai_review_status: "sent_back",
      ai_precheck_sendbacks: sendbacks + 1,
      status: "needs_changes",
      review_note: note,
      review_note_by: REVIEWER_LABEL,
    });
    if (!claimed) return; // unshipped, re-shipped or claimed meanwhile

    const { error: auditError } = await db.from("review_audits").insert({
      project_id: projectId,
      user_id: p.user_id,
      reviewer: AUDIT_REVIEWER,
      verdict: "needs_changes",
      note,
      claimed_hours: Math.round(((Number(p.hackatime_seconds) || 0) / 3600) * 10) / 10,
    });
    if (auditError) console.error("[precheck] review audit insert failed", auditError);
    const { error: modError } = await db.from("mod_actions").insert({
      user_id: p.user_id,
      action: "ai_precheck_sent_back",
      detail: `Project ${projectId} sent back: ${findings.blocking.join(", ")}`,
      actor: "system",
    });
    if (modError) console.error("[precheck] mod action insert failed", modError);
    audit({ actorType: "service", actorId: "ai-precheck", action: "precheck.sent_back", target: `project:${projectId}`, result: "ok", meta });

    await addNotification(
      p.user_id,
      "Changes requested",
      `"${p.name}" came back before review: it's missing things every project needs. Check the note on the project, fix them and ship again.`,
    );
    await dmOwner(p.user_id, dmFor(escapeMrkdwn(p.name), `${config.urls.site}/projects/${projectId}`, findings.blocking));
  } catch (e) {
    console.error("[precheck] run failed", projectId, (e as Error)?.message ?? e);
    try {
      await finish({ ai_review_status: "error", ai_review_error: String((e as Error)?.message ?? e).slice(0, 500) });
    } catch {}
    audit({ actorType: "service", actorId: "ai-precheck", action: "precheck.error", target: `project:${projectId}`, result: "error" });
  }
}
