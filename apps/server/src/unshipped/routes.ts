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

const router = Router();

// Macondo was dropped from this importer: its public API only exposes
// projects with has_shipped=true (confirmed by scanning the full corpus —
// zero drafts came back), so it can't do what this feature is for. Stardance
// stays because its per-user projects endpoint genuinely includes in-progress
// work.
const SOURCE = "stardance";

function cleanSlackId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

interface UnshippedCandidate {
  source: typeof SOURCE;
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

  const username = await findStardanceUsername(String(row?.display_name ?? ""), slackId);
  if (username) {
    const stardanceProjects = await stardanceProjectsForUser(username);
    for (const p of stardanceProjects) {
      if (takenRefs.has(`${SOURCE}:${p.id}`)) continue;
      const repo = normalizeProjectUrl(p.repoUrl);
      const demo = normalizeProjectUrl(p.demoUrl);
      if ((repo !== "" && takenUrls.has(repo)) || (demo !== "" && takenUrls.has(demo))) continue;
      candidates.push({
        source: SOURCE,
        ref: String(p.id),
        name: p.title,
        description: p.description,
        imageUrl: p.bannerUrl,
        repoUrl: p.repoUrl,
        demoUrl: p.demoUrl,
      });
    }
  }

  res.json({ ok: true, projects: candidates });
});

router.post("/api/projects/import-unshipped", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const ref = String(req.body?.ref ?? "").trim();
  if (req.body?.source !== SOURCE || !ref)
    return res.status(400).json({ ok: false, error: "candidate_required" });

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
    .eq("imported_unshipped_source", SOURCE)
    .eq("imported_unshipped_ref", ref)
    .maybeSingle();
  if (dupe) return res.status(409).json({ ok: false, error: "already_imported" });

  const username = await findStardanceUsername(String(row?.display_name ?? ""), slackId);
  if (!username) return res.status(404).json({ ok: false, error: "project_not_found" });
  const projects = await stardanceProjectsForUser(username);
  const match = projects.find((p) => String(p.id) === ref);
  if (!match) return res.status(404).json({ ok: false, error: "project_not_found" });

  const fields = {
    name: match.title,
    description: match.description,
    repoUrl: match.repoUrl,
    demoUrl: match.demoUrl,
    imageUrl: match.bannerUrl,
  };
  const parsed = parseProjectBody(fields);
  if (parsed.error !== undefined) return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: session.userId,
      ...parsed.fields,
      imported_unshipped_source: SOURCE,
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
  //
  // The insert is all-or-nothing (one bad row rolls the whole batch back),
  // so journalsImported below must reflect what actually landed, not what
  // we fetched — reporting a fake success count here would tell the user
  // their devlog history came in when the project row exists but the
  // journal rows don't, with a unique-index-enforced dupe check blocking
  // any retry.
  const devlogs = await stardanceDevlogsForProject(match.id);
  let journalsImported = 0;
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
    else journalsImported = devlogs.length;
  }

  void addNotification(
    session.userId,
    "Project imported",
    `"${parsed.fields.name}" came in from Stardance${
      journalsImported > 0 ? ` with ${journalsImported} devlog${journalsImported === 1 ? "" : "s"}` : ""
    }. Add a thumbnail and start logging hours here.${
      devlogs.length > 0 && journalsImported === 0
        ? " (Its devlog history couldn't be brought over this time.)"
        : ""
    }`,
  );
  res.json({ ok: true, project: data, journalsImported });
});

export default router;
