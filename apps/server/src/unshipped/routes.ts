import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "../routes/notifications.js";
import { parseProjectBody } from "../routes/projects.js";
import { normalizeProjectUrl } from "../ysws/archive.js";
import {
  findStardanceUsername,
  stardanceProjectsForUser,
  stardanceDevlogsForProject,
} from "./stardance.js";
import { macondoProjectsForSlackId } from "./macondo.js";

const router = Router();

function cleanSlackId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

interface UnshippedCandidate {
  source: "stardance" | "macondo";
  ref: string;
  name: string;
  description: string;
  imageUrl: string;
  repoUrl: string;
  demoUrl: string;
}

router.get("/api/projects/unshipped-available", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data: userRow } = await supabase
    .from("users")
    .select("slack_id, display_name")
    .eq("id", session.userId)
    .maybeSingle();
  const row = userRow as { slack_id?: string; display_name?: string } | null;
  const slackId = cleanSlackId(row?.slack_id);
  if (!slackId) return res.json({ ok: true, projects: [] });

  const { data: mine, error: mineError } = await supabase
    .from("projects")
    .select("imported_unshipped_source, imported_unshipped_ref, repo_url, demo_url")
    .eq("user_id", session.userId);
  if (mineError) {
    console.error("[unshipped] listing needs migration 0147", mineError);
    return res.json({ ok: true, projects: [] });
  }
  const takenRefs = new Set(
    (mine ?? [])
      .filter((p: any) => p.imported_unshipped_ref)
      .map((p: any) => `${p.imported_unshipped_source}:${p.imported_unshipped_ref}`),
  );
  const takenUrls = new Set<string>();
  for (const p of (mine ?? []) as { repo_url?: string | null; demo_url?: string | null }[]) {
    for (const u of [p.repo_url, p.demo_url]) {
      const n = normalizeProjectUrl(String(u ?? ""));
      if (n !== "") takenUrls.add(n);
    }
  }

  const candidates: UnshippedCandidate[] = [];

  const [username, macondoProjects] = await Promise.all([
    findStardanceUsername(String(row?.display_name ?? ""), slackId),
    macondoProjectsForSlackId(slackId),
  ]);

  if (username) {
    const stardanceProjects = await stardanceProjectsForUser(username);
    for (const p of stardanceProjects) {
      if (takenRefs.has(`stardance:${p.id}`)) continue;
      const repo = normalizeProjectUrl(p.repoUrl);
      const demo = normalizeProjectUrl(p.demoUrl);
      if ((repo !== "" && takenUrls.has(repo)) || (demo !== "" && takenUrls.has(demo))) continue;
      candidates.push({
        source: "stardance",
        ref: String(p.id),
        name: p.title,
        description: p.description,
        imageUrl: p.bannerUrl,
        repoUrl: p.repoUrl,
        demoUrl: p.demoUrl,
      });
    }
  }

  for (const p of macondoProjects) {
    if (takenRefs.has(`macondo:${p.id}`)) continue;
    candidates.push({
      source: "macondo",
      ref: String(p.id),
      name: p.name,
      description: p.description,
      imageUrl: p.thumbnailUrl,
      repoUrl: "",
      demoUrl: "",
    });
  }

  res.json({ ok: true, projects: candidates });
});

router.post("/api/projects/import-unshipped", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const source =
    req.body?.source === "macondo" ? "macondo" : req.body?.source === "stardance" ? "stardance" : "";
  const ref = String(req.body?.ref ?? "").trim();
  if (!source || !ref) return res.status(400).json({ ok: false, error: "candidate_required" });

  const { data: userRow } = await supabase
    .from("users")
    .select("slack_id, display_name")
    .eq("id", session.userId)
    .maybeSingle();
  const row = userRow as { slack_id?: string; display_name?: string } | null;
  const slackId = cleanSlackId(row?.slack_id);
  if (!slackId) return res.status(400).json({ ok: false, error: "no_slack_link" });

  const { data: dupe } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", session.userId)
    .eq("imported_unshipped_source", source)
    .eq("imported_unshipped_ref", ref)
    .maybeSingle();
  if (dupe) return res.status(409).json({ ok: false, error: "already_imported" });

  let fields: { name: string; description: string; repoUrl: string; demoUrl: string; imageUrl: string };
  let devlogs: { body: string; postedAt: string; images: string[] }[] = [];

  if (source === "stardance") {
    const username = await findStardanceUsername(String(row?.display_name ?? ""), slackId);
    if (!username) return res.status(404).json({ ok: false, error: "project_not_found" });
    const projects = await stardanceProjectsForUser(username);
    const match = projects.find((p) => String(p.id) === ref);
    if (!match) return res.status(404).json({ ok: false, error: "project_not_found" });
    fields = {
      name: match.title,
      description: match.description,
      repoUrl: match.repoUrl,
      demoUrl: match.demoUrl,
      imageUrl: match.bannerUrl,
    };
    devlogs = await stardanceDevlogsForProject(match.id);
  } else {
    const projects = await macondoProjectsForSlackId(slackId);
    const match = projects.find((p) => String(p.id) === ref);
    if (!match) return res.status(404).json({ ok: false, error: "project_not_found" });
    fields = {
      name: match.name,
      description: match.description,
      repoUrl: "",
      demoUrl: "",
      imageUrl: match.thumbnailUrl,
    };
  }

  const parsed = parseProjectBody(fields);
  if (parsed.error !== undefined) return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      ...parsed.fields,
      imported_unshipped_source: source,
      imported_unshipped_ref: ref,
    })
    .select()
    .single();
  if (error) {
    console.error("[unshipped] import failed", error);
    return res.status(500).json({ ok: false });
  }

  // Devlogs land as journal entries at 0 hours each — same "hours don't
  // carry over" rule the ships.hackclub.com import already enforces, only
  // new Hackatime-tracked work here counts toward payout.
  if (devlogs.length > 0) {
    const rows = devlogs.map((d) => ({
      project_id: data.id,
      user_id: session.userId,
      content:
        d.images.length > 0 ? `${d.body}\n\n${d.images.map((u) => `![](${u})`).join("\n")}` : d.body,
      hours: 0,
      created_at: d.postedAt || new Date().toISOString(),
    }));
    const { error: journalError } = await supabase.from("project_journals").insert(rows);
    if (journalError) console.error("[unshipped] devlog journal import failed", journalError);
  }

  void addNotification(
    session.userId,
    "Project imported",
    `"${parsed.fields.name}" came in from ${source === "stardance" ? "Stardance" : "Macondo"}${
      devlogs.length > 0 ? ` with ${devlogs.length} devlog${devlogs.length === 1 ? "" : "s"}` : ""
    }. Add a thumbnail and start logging hours here.`,
  );
  res.json({ ok: true, project: data, journalsImported: devlogs.length });
});

export default router;
