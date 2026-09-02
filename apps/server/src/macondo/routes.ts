import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "../routes/notifications.js";
import { parseProjectBody } from "../routes/projects.js";
import { macondoProjectForSlackId, macondoProjectsForSlackId } from "./client.js";

const router = Router();
const SOURCE = "macondo";

interface ImportedProjectRow {
  readonly imported_unshipped_source?: string | null;
  readonly imported_unshipped_ref?: string | null;
}

function cleanSlackId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  return value === "null" || value === "undefined" ? "" : value;
}

function projectTypeForMacondo(type: string): string {
  return type === "hardware" ? "hardware" : "other";
}

function sourceDate(raw: string): string {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

router.get("/api/projects/macondo-available", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data: userRow } = await supabase
    .from("users")
    .select("slack_id")
    .eq("id", session.userId)
    .maybeSingle();
  const slackId = cleanSlackId((userRow as { slack_id?: string } | null)?.slack_id);
  if (!slackId) return res.json({ ok: true, projects: [] });

  const { data: mine, error: mineError } = await supabase
    .from("projects")
    .select("imported_unshipped_source, imported_unshipped_ref")
    .eq("user_id", session.userId);
  if (mineError) {
    console.error("[macondo] listing needs migration 0147", mineError);
    return res.json({ ok: true, projects: [] });
  }

  const rows = (mine ?? []) as ImportedProjectRow[];
  const takenRefs = new Set(
    rows
      .filter((project) => project.imported_unshipped_source === SOURCE && project.imported_unshipped_ref)
      .map((project) => project.imported_unshipped_ref),
  );
  const projects = await macondoProjectsForSlackId(slackId);
  res.json({
    ok: true,
    projects: projects
      .filter((project) => !takenRefs.has(String(project.id)))
      .map((project) => ({
        source: SOURCE,
        ref: String(project.id),
        name: project.name,
        description: project.description,
        imageUrl: project.thumbnailUrl,
        repoUrl: "",
        demoUrl: "",
        hasShipped: project.hasShipped,
      })),
  });
});

router.post("/api/projects/import-macondo", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const projectId = Number(req.body?.ref);
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    return res.status(400).json({ ok: false, error: "project_required" });

  const { data: userRow } = await supabase
    .from("users")
    .select("slack_id")
    .eq("id", session.userId)
    .maybeSingle();
  const slackId = cleanSlackId((userRow as { slack_id?: string } | null)?.slack_id);
  if (!slackId) return res.status(400).json({ ok: false, error: "no_slack_link" });

  const { data: dupe } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", session.userId)
    .eq("imported_unshipped_source", SOURCE)
    .eq("imported_unshipped_ref", String(projectId))
    .maybeSingle();
  if (dupe) return res.status(409).json({ ok: false, error: "already_imported" });

  const lookup = await macondoProjectForSlackId(slackId, projectId);
  if (lookup.kind === "not_found")
    return res.status(404).json({ ok: false, error: "project_not_found" });
  if (lookup.kind === "unavailable")
    return res.status(502).json({ ok: false, error: "macondo_unavailable" });
  const project = lookup.project;

  const parsed = parseProjectBody({
    name: project.name,
    description: project.description,
    repoUrl: project.repoUrl,
    demoUrl: project.demoUrl,
    imageUrl: project.thumbnailUrl,
    projectType: projectTypeForMacondo(project.type),
    kind: project.type === "hardware" ? "hardware" : "software",
  });
  if (parsed.error !== undefined) return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      ...parsed.fields,
      imported_unshipped_source: SOURCE,
      imported_unshipped_ref: String(project.id),
    })
    .select()
    .single();
  if (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505") return res.status(409).json({ ok: false, error: "already_imported" });
    console.error("[macondo] project import failed", error);
    return res.status(500).json({ ok: false });
  }

  const journals = project.journals.filter((journal) => !journal.archived && journal.content);
  let journalsImported = 0;
  if (journals.length > 0) {
    const { error: journalError } = await supabase.from("project_journals").insert(
      journals.map((journal) => ({
        project_id: data.id,
        user_id: session.userId,
        title: journal.title,
        content: journal.content,
        hours: 0,
        created_at: sourceDate(journal.createdAt),
      })),
    );
    if (journalError) {
      console.error("[macondo] journal import failed", journalError);
      await supabase
        .from("projects")
        .delete()
        .eq("id", data.id)
        .eq("user_id", session.userId);
      return res.status(500).json({ ok: false, error: "journal_import_failed" });
    }
    journalsImported = journals.length;
  }

  void addNotification(
    session.userId,
    "Project imported",
    `"${parsed.fields.name}" came in from Macondo${
      journalsImported > 0 ? ` with ${journalsImported} journal${journalsImported === 1 ? "" : "s"}` : ""
    }. Historical Macondo hours don't carry over; new time tracked here does.`,
  );
  res.json({ ok: true, project: data, journalsImported });
});

export default router;
