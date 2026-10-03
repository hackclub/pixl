import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "./notifications.js";
import { findAllInYswsArchive } from "../ysws/archive.js";
import { buildDoubleDip, type TeamMember } from "../ysws/doubleDip.js";
import { fetchHackatimeStats, fetchTrackedSecondsSince, HACKATIME_CUTOFF } from "../hackatime/api.js";
import { postShipToSlack } from "../shipNotify.js";
import {
  shipEligibilityBlock,
  MANUAL_ELIGIBILITY_OVERRIDE_USER_IDS,
  type HcaStateRow,
} from "../hcaEligibility.js";
import { normalizeProjectUrl } from "./projectUrlSafety.js";
import { isGitRepoUrl } from "./gitRepoUrl.js";
import { urlAlive } from "./urlLiveness.js";
import { recordShipForOperations } from "../operations/service.js";

const router = Router();

// The date a project's Hackatime hours count from: the event cutoff, or the
// earlier date a reviewer extended it to (projects.hours_extended_since).
function projectCutoffUnix(extendedSince: string | null | undefined): number {
  const ms = extendedSince ? new Date(extendedSince).getTime() : NaN;
  return Number.isFinite(ms) && ms < HACKATIME_CUTOFF * 1000 ? Math.floor(ms / 1000) : HACKATIME_CUTOFF;
}

// Explicit allowlist of what a raw `projects` row hands back to its own
// owner (or an accepted collaborator) - list/create/update/ship/unship all
// go through this. A denylist here kept missing new staff/admin columns as
// migrations added them (reviewing_at, the ai_review_* block, hours_extended_*,
// journal_share_token, ...) - an unlisted column is dropped by default instead,
// so a new migration can't silently start leaking. approved_hours/
// first_pass_hours are proposals until a project is actually approved, so
// they're gated here rather than left to each call site to remember.
const PLAYER_PROJECT_FIELDS = [
  "id",
  "name",
  "description",
  "repo_url",
  "demo_url",
  "image_url",
  "project_type",
  "kind",
  "used_ai",
  "ai_notes",
  "hackatime_projects",
  "hackatime_seconds",
  "level",
  "needs_funding",
  "funding_usd",
  "bom_url",
  "cart_screenshot_urls",
  "finished_build",
  "other_ysws",
  "other_ysws_notes",
  "status",
  "created_at",
  "shipped_at",
  "rejected_at",
  "reject_reason",
  "review_note",
  "banned_at",
  "is_update",
  "update_notes",
  "ship_note",
  "eligibility_attested",
  "sidequest_id",
  "trial_reward_choice",
  "trial_held_px",
  "trial_prize_px",
  "join_code",
  "is_peak",
  // The date a reviewer extended this project's hours cutoff to - the owner is
  // already DMed it, and the project page needs it to count from there.
  // hours_extended_by/_note stay internal.
  "hours_extended_since",
] as const;

export function toPlayerProject(p: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const field of PLAYER_PROJECT_FIELDS) safe[field] = p[field] ?? null;
  // Credited (possibly deflated) hours only become real once a project is
  // actually approved - a stale value from an earlier review cycle must not
  // leak back out on the very next save/ship/unship.
  const approved = p.status === "approved";
  safe.approved_hours = approved ? (p.approved_hours ?? null) : null;
  safe.first_pass_hours = approved ? (p.first_pass_hours ?? null) : null;
  // A first-pass "ban" verdict is only a PROPOSAL - it parks the project in
  // second_review (or fraud_review) for a different final reviewer to
  // confirm or overturn, the exact same status column value an ordinary
  // approved-and-awaiting-final ship sits in. The maker must not see any
  // sign that a ban is even on the table until it's actually confirmed
  // (banned_at gets set) or overturned, so this reports the status they'd
  // see for a still-in-review ship instead. See the matching event filter
  // in the /timeline route.
  //
  // !p.banned_at matters: reviewProject's ban-confirm branch clears
  // first_pass_verdict back to null, but banProject (the standalone "Ban
  // project" button, usable at any stage) sets banned_at without touching
  // first_pass_verdict at all - without this check, a project banned that
  // way would stay masked forever even though it's genuinely, permanently
  // banned. banned_at itself is never masked (see PLAYER_PROJECT_FIELDS
  // above), so this only ever widens what still counts as "not yet decided".
  if (
    (p.status === "second_review" || p.status === "fraud_review") &&
    p.first_pass_verdict === "banned" &&
    !p.banned_at
  ) {
    safe.status = "shipped";
  }
  return safe;
}

// What kind of thing the player shipped , shown to reviewers so they know how
// to judge it (a web game vs a hardware build vs a CAD model are graded
// differently). Kept in sync with the dropdown in apps/game/web/projects.
const PROJECT_TYPES = [
  "web",
  "windows",
  "mac",
  "linux",
  "cross_platform",
  "python",
  "android",
  "ios",
  "hardware",
  "cad",
  "other",
];

// List the logged-in user's projects, newest first , their own plus any
// they're an accepted collaborator on (view/log-hours only, not editable).
router.get("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data: owned, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", session.userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[projects] list failed", error);
    return res.status(500).json({ ok: false });
  }

  const { data: collabRows } = await supabase
    .from("project_collaborators")
    .select("project_id")
    .eq("user_id", session.userId)
    .eq("status", "accepted");
  const collabProjectIds = (collabRows ?? []).map((r) => r.project_id as number);
  let collaborating: Record<string, unknown>[] = [];
  if (collabProjectIds.length > 0) {
    const { data } = await supabase
      .from("projects")
      .select("*")
      .in("id", collabProjectIds)
      .is("archived_at", null);
    collaborating = data ?? [];
  }

  const projects = [
    ...(owned ?? []).map((p) => ({ ...p, is_owner: true })),
    ...collaborating.map((p) => ({ ...p, is_owner: false })),
  ].sort(
    (a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime(),
  );
  const ids = projects.map((p) => p.id as number);
  const earned = new Map<number, number>();
  if (ids.length > 0) {
    const { data: txs } = await supabase
      .from("pixel_transactions")
      .select("project_id, amount")
      .in("project_id", ids)
      .in("reason", ["project_approved", "review_reverted"]);
    for (const t of txs ?? [])
      earned.set(
        t.project_id as number,
        (earned.get(t.project_id as number) ?? 0) + Number(t.amount),
      );
  }
  const journalSeconds = new Map<number, number>();
  const ownedIds = (owned ?? []).map((p) => p.id as number);
  if (ownedIds.length > 0) {
    const { data: jrows } = await supabase
      .from("project_journals")
      .select("project_id, hours")
      .in("project_id", ownedIds);
    for (const j of jrows ?? [])
      journalSeconds.set(
        j.project_id as number,
        (journalSeconds.get(j.project_id as number) ?? 0) + (Number(j.hours) || 0) * 3600,
      );
  }
  if (collabProjectIds.length > 0) {
    const { data: jrows } = await supabase
      .from("project_journals")
      .select("project_id, hours")
      .in("project_id", collabProjectIds)
      .eq("user_id", session.userId);
    for (const j of jrows ?? [])
      journalSeconds.set(
        j.project_id as number,
        (journalSeconds.get(j.project_id as number) ?? 0) + (Number(j.hours) || 0) * 3600,
      );
  }
  // Resolve the linked Trial name, and what the Trial actually hands over, for
  // any project shipped for one - so the client can show the name and (for an
  // approved ship still waiting on the reward choice) both sides of that choice
  // without a second round-trip.
  const trialName = new Map<number, string>();
  const trialPrize = new Map<number, string>();
  const trialIds = [
    ...new Set(
      projects.map((p) => p.sidequest_id as number | null).filter((x): x is number => !!x),
    ),
  ];
  if (trialIds.length > 0) {
    const { data: sqs } = await supabase
      .from("sidequests")
      .select("id, name, reward, prize_shop_item_id")
      .in("id", trialIds);
    const itemIds = [
      ...new Set(
        (sqs ?? [])
          .map((s) => s.prize_shop_item_id as number | null)
          .filter((x): x is number => !!x),
      ),
    ];
    const itemName = new Map<number, string>();
    if (itemIds.length > 0) {
      const { data: items } = await supabase.from("shop_items").select("id, name").in("id", itemIds);
      for (const i of items ?? []) itemName.set(i.id as number, i.name as string);
    }
    for (const s of sqs ?? []) {
      trialName.set(s.id as number, s.name as string);
      trialPrize.set(
        s.id as number,
        itemName.get(s.prize_shop_item_id as number) ??
          (s.reward as string) ??
          (s.name as string),
      );
    }
  }
  res.json({
    ok: true,
    projects: projects.map((p) => ({
      ...toPlayerProject(p),
      is_owner: p.is_owner,
      pixels_earned: earned.get(p.id as number) ?? 0,
      journal_seconds: journalSeconds.get(p.id as number) ?? 0,
      sidequest_name: p.sidequest_id
        ? (trialName.get(p.sidequest_id as number) ?? null)
        : null,
      trial_prize_name: p.sidequest_id
        ? (trialPrize.get(p.sidequest_id as number) ?? null)
        : null,
    })),
  });
});

// A hardware "design" ship (project_type "cad") never got built, so a
// schematic/PCB viewer link stands in for a demo. KiCanvas is the one
// reviewers actually use for this.
function isKicanvasUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  return host === "kicanvas.org";
}

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "loom.com",
  "streamable.com",
  "drive.google.com",
]);

// A hardware "build" ship must demo the physical thing actually working , a
// screenshot or a CAD viewer link doesn't show that, only a video does.
function isVideoUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  return VIDEO_HOSTS.has(host);
}

// A demo must be a playable page, not the source. A bare github.com/<user>/<repo>
// link is rejected; github *releases* pages are allowed (they host builds).
// Hardware ships are the exception: there's often no playable web page at
// all, so the repo itself (build photos, schematics, docs) is the natural
// stand-in - the stricter isDesign/finished_build checks right after this
// call still enforce a real Kicanvas link or video where those genuinely
// matter, this only lifts the generic "that's just source" rejection.
function normalizeDemoUrl(raw: string, isHardware: boolean): { error: string } | { url: string } {
  const normalized = normalizeProjectUrl(raw);
  if (!normalized.ok) return { error: "demo_invalid" };
  const s = normalized.url;
  if (!s) return { url: "" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "demo_invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "demo_invalid" };
  const host = u.hostname.replace(/^www\./, "");
  if (!isHardware && host === "github.com" && !/\/releases(\/|$)/.test(u.pathname))
    return { error: "demo_is_repo" };
  return { url: u.toString() };
}

interface ProjectFields {
  name: string;
  description: string;
  repo_url: string;
  demo_url: string;
  image_url: string;
  project_type: string;
  used_ai: boolean;
  ai_notes: string;
  hackatime_projects: string[];
  level: number;
  kind: string;
  needs_funding: boolean;
  funding_usd: number;
  bom_url: string;
  cart_screenshot_urls: string[];
  finished_build: boolean;
  other_ysws: boolean;
  other_ysws_notes: string;
}

// Shared field parsing/validation for create + update. Returns an error code
// on a missing name or a repo link that isn't a GitHub repository. Also used by
// the YSWS importer (src/ysws/routes.ts) to turn an archive entry into a draft.
//
// Tier ("level" in the DB) is a player self-assessment (1-4): the builder picks
// it on the project page as a starting point. Reviewers still set the FINAL tier
// via the verdict form at review, which is what payout actually uses, so this is
// only a suggestion. Clamped 1-4; anything missing/invalid falls back to 1.
export function parseProjectBody(
  body: any,
): { error: string; fields?: never } | { error?: never; fields: ProjectFields } {
  const name = String(body?.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "name_required" };
  // Save accepts any ordinary link , repo/demo are only checked for being the
  // *right kind* of link (a GitHub repo, a live demo) at ship time, so people
  // can jot one down and fix it up before shipping. But a dangerous URL
  // scheme (javascript:, vbscript:, file:, data:, ...) is never acceptable at
  // any stage, ship-time or not: a draft (which never goes through ship-time
  // validation) is still exposed read-only via GET /api/explore/projects, and
  // every page that renders repo_url/demo_url puts it straight into
  // <a href=...> - HTML-escaping that value doesn't stop a dangerous scheme
  // from executing when someone clicks it. normalizeProjectUrl rejects those
  // outright instead of storing them.
  const repoUrlResult = normalizeProjectUrl(body?.repoUrl);
  if (!repoUrlResult.ok) return { error: "repo_invalid" };
  const demoUrlResult = normalizeProjectUrl(body?.demoUrl);
  if (!demoUrlResult.ok) return { error: "demo_invalid" };
  const repoUrl = repoUrlResult.url;
  const demoUrl = demoUrlResult.url;
  const usedAi = body?.usedAi === true;
  const aiNotes = String(body?.aiNotes ?? "").trim().slice(0, 2000);
  if (usedAi && aiNotes.length < 10) return { error: "ai_notes_required" };
  const projectType = PROJECT_TYPES.includes(String(body?.projectType))
    ? String(body?.projectType)
    : "other";
  const kind = body?.kind === "hardware" ? "hardware" : "software";
  // Funding is a hardware-only ask, held clean for software so a kind switch
  // back to software can't leave stale funding data sitting on the row.
  const needsFunding = kind === "hardware" && body?.needsFunding === true;
  const fundingUsd = needsFunding
    ? Math.min(Math.max(Number(body?.fundingUsd) || 0, 0), 100000)
    : 0;
  // BOM URLs are written only by the project-scoped upload endpoint. Accepting
  // them from this general project payload would let callers attach arbitrary
  // storage URLs without the endpoint's ownership and CSV checks.
  const bomUrl = "";
  // image_url is normally the real upload endpoint's own storage URL, but this
  // payload still accepts it directly (unlike bom_url above) - defense in
  // depth against a dangerous scheme landing here the same way repo_url/
  // demo_url could. <img src="javascript:...">  doesn't execute in modern
  // browsers, but there's no reason to store a non-http(s) value here either.
  const imageUrlResult = normalizeProjectUrl(body?.imageUrl);
  const imageUrl = imageUrlResult.ok ? imageUrlResult.url : "";
  const cartScreenshotUrls = needsFunding && Array.isArray(body?.cartScreenshotUrls)
    ? body.cartScreenshotUrls.map((u: unknown) => String(u)).slice(0, 10)
    : [];
  // Whether the physical thing actually exists and can be filmed working -
  // distinct from needsFunding, which by definition happens before a build
  // exists. Hardware-only, same reasoning as needsFunding above.
  const finishedBuild = kind === "hardware" && body?.finishedBuild === true;
  const otherYsws = body?.otherYsws === true;
  const otherYswsNotes = String(body?.otherYswsNotes ?? "").trim().slice(0, 2000);
  return {
    fields: {
      name,
      description: String(body?.description ?? "").trim().slice(0, 2000),
      repo_url: repoUrl,
      demo_url: demoUrl,
      image_url: imageUrl,
      project_type: projectType,
      used_ai: usedAi,
      ai_notes: usedAi ? aiNotes : "",
      hackatime_projects: Array.isArray(body?.hackatimeProjects)
        ? body.hackatimeProjects.map((p: unknown) => String(p)).slice(0, 50)
        : [],
      level: Math.min(4, Math.max(1, Math.round(Number(body?.level)) || 1)),
      // Software vs hardware track, chosen at creation. Hardware ships don't
      // require Hackatime and go to their own review queue.
      kind,
      needs_funding: needsFunding,
      funding_usd: fundingUsd,
      bom_url: bomUrl,
      cart_screenshot_urls: cartScreenshotUrls,
      finished_build: finishedBuild,
      other_ysws: otherYsws,
      other_ysws_notes: otherYsws ? otherYswsNotes : "",
    },
  };
}

// The Trial a project is being built for is chosen at CREATION now (not at
// ship). A player can only link a Trial they've actually accepted in-game
// (there's a sidequest_unlocks row); picking one they haven't accepted returns
// "trial_not_accepted" so the client can tell them to go accept it first. 0 /
// missing = building their own idea.
async function resolveTrialLink(
  userId: string,
  wantSidequest: unknown,
): Promise<{ error: string } | { id: number | null }> {
  const want = Number(wantSidequest);
  if (!Number.isFinite(want) || want <= 0) return { id: null };
  const { data: unlock } = await supabase
    .from("sidequest_unlocks")
    .select("sidequest_id, sidequests!inner(active)")
    .eq("user_id", userId)
    .eq("sidequest_id", want)
    .eq("sidequests.active", true)
    .maybeSingle();
  if (!unlock) return { error: "trial_not_accepted" };
  return { id: want };
}

// Create a project, optionally linked to HackTime project names.
router.post("/api/projects", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const parsed = parseProjectBody(req.body);
  if (parsed.error !== undefined)
    return res.status(400).json({ ok: false, error: parsed.error });

  const trial = await resolveTrialLink(session.userId, req.body?.sidequestId);
  if ("error" in trial) return res.status(400).json({ ok: false, error: trial.error });

  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: session.userId, ...parsed.fields, sidequest_id: trial.id })
    .select()
    .single();
  if (error) {
    console.error("[projects] create failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(session.userId, "Project logged", `You logged "${parsed.fields.name}".`);
  res.json({ ok: true, project: toPlayerProject(data) });
});

// Update one of the user's own projects.
router.put("/api/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const parsed = parseProjectBody(req.body);
  if (parsed.error !== undefined)
    return res.status(400).json({ ok: false, error: parsed.error });

  // The player-set tier is only a pre-review suggestion. Once a project is
  // approved its level is what lifetimeRe() weights hours by, so a player must
  // NOT be able to re-grade an approved project (that would retroactively inflate
  // their RE). Keep the existing level on approved projects; the reviewer owns it.
  const { data: cur } = await supabase
    .from("projects")
    .select("status, level, sidequest_id, bom_url")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  const fields: Record<string, unknown> = { ...parsed.fields };
  fields.bom_url = (cur as { bom_url?: string } | null)?.bom_url ?? "";

  // Trial link is picked at creation and editable while the project is a draft.
  // Same acceptance rule as create: only a Trial the player has accepted links.
  const trial = await resolveTrialLink(session.userId, req.body?.sidequestId);
  if ("error" in trial) return res.status(400).json({ ok: false, error: trial.error });
  fields.sidequest_id = trial.id;

  // On an approved project, neither the tier nor the Trial link may change (both
  // feed payout/RE that already settled) , keep whatever the reviewer approved.
  if ((cur as { status?: string } | null)?.status === "approved") {
    fields.level = (cur as { level?: number }).level ?? 1;
    fields.sidequest_id = (cur as { sidequest_id?: number | null }).sidequest_id ?? null;
  }

  const { data, error } = await supabase
    .from("projects")
    .update(fields)
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (error) {
    console.error("[projects] update failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, project: toPlayerProject(data) });
});

// Ship a project for review: draft/needs_changes -> shipped, or approved ->
// shipped again as an update (requires update notes). Requires repo, demo,
// thumbnail, and an eligibility attestation (not a school assignment or paid
// Hack Club work). Undisclosed matches against the Hack Club YSWS archive get
// a system note for the reviewer plus a mod_actions entry.
router.post("/api/projects/:id/ship", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (error || !project) return res.status(404).json({ ok: false });

  if (project.banned_at)
    return res.status(400).json({ ok: false, error: "project_banned" });

  const shippable = ["draft", "needs_changes", "approved"];
  if (!shippable.includes(project.status as string) && !project.rejected_at)
    return res.status(400).json({ ok: false, error: "already_shipped" });

  const { data: hcaRow, error: hcaError } = await supabase
    .from("users")
    .select("hca_verification_status, hca_ysws_eligible")
    .eq("id", session.userId)
    .maybeSingle();
  if (hcaError) {
    console.error("[projects] hca state fetch failed", hcaError.message);
    return res.status(500).json({ ok: false });
  }
  const hcaBlock = shipEligibilityBlock(hcaRow as HcaStateRow | null);
  if (hcaBlock && !MANUAL_ELIGIBILITY_OVERRIDE_USER_IDS.has(session.userId))
    return res
      .status(403)
      .json({ ok: false, error: hcaBlock.error, message: hcaBlock.message, hca_status: hcaBlock.status });

  if (!project.repo_url)
    return res.status(400).json({ ok: false, error: "repo_required" });
  if (!project.demo_url)
    return res.status(400).json({ ok: false, error: "demo_required" });
  if (!String(project.image_url ?? "").trim())
    return res.status(400).json({ ok: false, error: "image_required" });
  // Hard exclusion under Hack Club's YSWS "Project Exceptions" , school
  // assignments and paid Hack Club work can't go into the Unified Database.
  if (req.body?.eligibilityAttested !== true)
    return res.status(400).json({ ok: false, error: "eligibility_attestation_required" });
  // URLs are only validated here, at ship time (save accepts anything).
  if (!(await isGitRepoUrl(project.repo_url as string)))
    return res.status(400).json({ ok: false, error: "repo_not_git" });
  const isHardware = project.kind === "hardware";
  const demoCheck = normalizeDemoUrl(project.demo_url as string, isHardware);
  if ("error" in demoCheck)
    return res.status(400).json({ ok: false, error: demoCheck.error });

  const [repoAlive, demoAlive] = await Promise.all([
    urlAlive(project.repo_url as string),
    urlAlive(project.demo_url as string),
  ]);
  if (!repoAlive)
    return res.status(400).json({ ok: false, error: "repo_not_found" });
  if (!demoAlive)
    return res.status(400).json({ ok: false, error: "demo_unreachable" });

  // A funded hardware ship needs the reviewer to be able to verify the ask:
  // what it's for (BOM), what it costs (cart screenshots, with shipping),
  // and how much (the dollar amount). Same "block at ship, not at save" shape
  // as the other checklist items above.
  if (isHardware && project.needs_funding) {
    if (!String(project.bom_url ?? "").trim())
      return res.status(400).json({ ok: false, error: "bom_required" });
    if (!Array.isArray(project.cart_screenshot_urls) || project.cart_screenshot_urls.length === 0)
      return res.status(400).json({ ok: false, error: "cart_screenshot_required" });
    if (!(Number(project.funding_usd) > 0))
      return res.status(400).json({ ok: false, error: "funding_amount_required" });
  }

  // A hardware "design" (CAD Models) ship never gets physically built, so a
  // schematic/PCB viewer link stands in for a demo. A kicanvas.org link is
  // unambiguous proof of a design ship on its own, so it's accepted
  // regardless of project_type - don't make an unrelated dropdown (easy to
  // leave on its default) block an otherwise-legit design submission.
  // Everything else claiming to be hardware only needs a video proving the
  // physical build works once it's actually built (finished_build) - a
  // funding-only ship can't possibly have that yet, so it's not required
  // until the maker ticks that they've built the thing.
  if (isHardware) {
    const demoUrl = project.demo_url as string;
    const isDesign = project.project_type === "cad";
    if (isDesign) {
      if (!isKicanvasUrl(demoUrl) && !isVideoUrl(demoUrl))
        return res.status(400).json({ ok: false, error: "design_demo_invalid" });
    } else if (project.finished_build && !isVideoUrl(demoUrl)) {
      return res.status(400).json({ ok: false, error: "build_demo_video_required" });
    }
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("hackatime_token, slack_id, display_name, address_line1, address_city, address_country, address_postal")
    .eq("id", session.userId)
    .single();
  const htToken = (userRow as { hackatime_token?: string } | null)?.hackatime_token ?? null;
  const ownerSlackId = (userRow as { slack_id?: string } | null)?.slack_id ?? null;
  const ownerLabel = (userRow as { display_name?: string } | null)?.display_name || "the player";
  // A mailing address is required before shipping , same fields/shape as
  // hasAddress() in routes/profile.ts and the shop checkout gate in
  // routes/shop.ts. It comes from Hack Club Auth at login (see
  // extractAddress in routes/auth.ts), not a Pixl-side form, so a missing
  // address means the player needs to fill it in on Hack Club Auth and
  // re-log-in , not something this endpoint can fix for them.
  const addr = userRow as {
    address_line1?: string | null;
    address_city?: string | null;
    address_country?: string | null;
    address_postal?: string | null;
  } | null;
  const hasAddress =
    !!String(addr?.address_line1 ?? "").trim() &&
    !!String(addr?.address_city ?? "").trim() &&
    !!String(addr?.address_country ?? "").trim() &&
    !!String(addr?.address_postal ?? "").trim();
  if (!hasAddress)
    return res.status(400).json({ ok: false, error: "address_required" });

  const stats = await fetchHackatimeStats(htToken);
  // Software must have a working Hackatime connection; hardware treats Hackatime
  // as optional (journal hours can stand in), so a hardware ship never fails on
  // Hackatime being unavailable.
  if (!isHardware && !stats.connected && stats.error)
    return res.status(502).json({ ok: false, error: "hackatime_unavailable" });
  const linked = (project.hackatime_projects as string[]) ?? [];
  // Only hours logged from the cutoff onward count , see HACKATIME_CUTOFF -
  // unless a reviewer extended this project's cutoff (dashboard's
  // extendHoursCutoff), in which case recomputing from the default here would
  // both block the ship and overwrite the extended hackatime_seconds below.
  const htSeconds = await fetchTrackedSecondsSince(
    ownerSlackId,
    htToken,
    linked,
    projectCutoffUnix(project.hours_extended_since as string | null),
  );
  // Hardware also counts journalled hours toward the tracked total, so journals
  // alone can carry a hardware ship; the total is journal + Hackatime. Software
  // stays Hackatime-only for its floor.
  let journalSeconds = 0;
  if (isHardware) {
    const { data: jrows } = await supabase
      .from("project_journals")
      .select("hours")
      .eq("project_id", id)
      .eq("user_id", session.userId);
    const jhours = ((jrows ?? []) as { hours: number | null }[]).reduce(
      (s, j) => s + (Number(j.hours) || 0),
      0,
    );
    // Summing decimal hours in floating point (e.g. 0.2 + 2.7 + ...) can land
    // on something like 20.599999999999998, which * 3600 becomes a
    // non-integer number of seconds - hackatime_seconds is an integer
    // column, and Postgres rejects that outright (22P02) instead of
    // truncating it, which is exactly what broke shipping project 251.
    journalSeconds = Math.round(jhours * 3600);
  }
  const trackedSeconds = htSeconds + journalSeconds;
  // Software needs at least an hour of tracked time to ship; hardware has no
  // floor here - a build can be legitimately quick, and the BOM/cart/funding
  // checks above (plus review) are what actually gate a funded hardware ship.
  if (!isHardware && trackedSeconds < 3600)
    return res.status(400).json({ ok: false, error: "hackatime_hours_required" });

  // Refresh each accepted collaborator's own tracked hours (their own
  // Hackatime account, filtered by the projects *they* linked) so review-time
  // crediting has up-to-date numbers per person. Purely informational , it
  // never gates whether this ship goes through.
  const { data: collaborators } = await supabase
    .from("project_collaborators")
    .select("id, user_id, hackatime_projects")
    .eq("project_id", id)
    .eq("status", "accepted");
  // Fed into buildDoubleDip below so a matched prior submission's per-person
  // hours can be checked against each current collaborator's OWN tracked
  // time, not just the owner's - see TeamMember in ysws/doubleDip.ts.
  const collaboratorTeam: TeamMember[] = [];
  if (collaborators && collaborators.length > 0) {
    const collaboratorIds = collaborators.map((c) => c.user_id as string);
    const { data: collabUsers } = await supabase
      .from("users")
      .select("id, hackatime_token, slack_id, display_name")
      .in("id", collaboratorIds);
    const tokenFor = new Map(
      (collabUsers ?? []).map((u) => [u.id as string, u.hackatime_token as string | null]),
    );
    const slackFor = new Map(
      (collabUsers ?? []).map((u) => [u.id as string, u.slack_id as string | null]),
    );
    const nameFor = new Map(
      (collabUsers ?? []).map((u) => [u.id as string, u.display_name as string | null]),
    );
    await Promise.all(
      collaborators.map(async (c) => {
        const collabLinked = (c.hackatime_projects as string[]) ?? [];
        const collabSlackId = slackFor.get(c.user_id as string) ?? null;
        const collabSeconds = await fetchTrackedSecondsSince(
          collabSlackId,
          tokenFor.get(c.user_id as string) ?? null,
          collabLinked,
        );
        await supabase
          .from("project_collaborators")
          .update({ hackatime_seconds: collabSeconds })
          .eq("id", c.id);
        collaboratorTeam.push({
          slackId: collabSlackId ?? "",
          label: nameFor.get(c.user_id as string) || "a collaborator",
          claimedHours: Math.round(((collabSeconds ?? 0) / 3600) * 10) / 10,
        });
      }),
    );
  }

  const isUpdate = project.status === "approved" && !project.rejected_at;
  const updateNotes = String(req.body?.updateNotes ?? "").trim().slice(0, 8000);
  const shipNote = String(req.body?.shipNote ?? "").trim().slice(0, 2000);
  if (isUpdate && !updateNotes)
    return res.status(400).json({ ok: false, error: "update_notes_required" });
  if (isUpdate && updateNotes.length < 100)
    return res.status(400).json({ ok: false, error: "update_notes_too_short" });
  const userDisclosedOtherYsws = req.body?.otherYsws === true;
  const otherYsws = userDisclosedOtherYsws || !!project.imported_ysws_entry_id;
  const otherYswsNotes = String(req.body?.otherYswsNotes ?? "").trim().slice(0, 2000);
  if (userDisclosedOtherYsws && !otherYswsNotes)
    return res.status(400).json({ ok: false, error: "other_ysws_notes_required" });
  if (userDisclosedOtherYsws && otherYswsNotes.length < 100)
    return res.status(400).json({ ok: false, error: "other_ysws_notes_too_short" });

  // The Trial link was chosen at creation (project.sidequest_id). Re-validate it
  // here and enforce the Trial's minimum hours against the tracked total above
  // (journal + Hackatime for hardware). If the Trial was since deleted/deactivated
  // or the minimum isn't met, the ship still goes through as the player's own idea.
  const wantSidequest = Number(project.sidequest_id);
  let sidequestId: number | null = null;
  if (Number.isFinite(wantSidequest) && wantSidequest > 0) {
    const { data: unlock } = await supabase
      .from("sidequest_unlocks")
      .select("sidequest_id, sidequests!inner(active, name, min_hours)")
      .eq("user_id", session.userId)
      .eq("sidequest_id", wantSidequest)
      .eq("sidequests.active", true)
      .maybeSingle();
    if (!unlock)
      return res.status(400).json({ ok: false, error: "trial_not_available" });
    sidequestId = wantSidequest;

    // A Trial can carry a minimum tracked-hours requirement (nullable = no
    // gate, e.g. Trials seeded before this existed). Checked against the same
    // trackedSeconds the normal 1h ship floor uses below.
    const trial = (unlock as { sidequests?: { name?: string; min_hours?: number | null } })
      .sidequests;
    const minHours = trial?.min_hours != null ? Number(trial.min_hours) : null;
    if (minHours != null && trackedSeconds < minHours * 3600) {
      // The player can choose to ship anyway (client shows this as an explicit
      // confirm) - they keep the pixels for the hours they actually worked,
      // they just don't get credited toward this Trial (no prize), same as
      // shipping their own idea. Ask once, then respect acceptNoTrialPrize.
      if (req.body?.acceptNoTrialPrize !== true) {
        return res.status(400).json({
          ok: false,
          error: "trial_hours_below_minimum",
          need: minHours,
          have: Math.round((trackedSeconds / 3600) * 10) / 10,
        });
      }
      sidequestId = null;
    }
  }

  const matches = await findAllInYswsArchive(
    project.repo_url as string,
    project.demo_url as string,
  );
  const { systemNote, flagDetail } = buildDoubleDip({
    project: {
      name: project.name as string,
      imported_ysws_entry_id: (project.imported_ysws_entry_id as string | null) ?? null,
      imported_from_ysws: (project.imported_from_ysws as string | null) ?? null,
      imported_ysws_hours: project.imported_ysws_hours != null
        ? Number(project.imported_ysws_hours)
        : null,
      imported_ysws_approved_at: (project.imported_ysws_approved_at as string | null) ?? null,
    },
    matches,
    otherYsws,
    trackedSeconds,
    collaborators: collaboratorTeam,
    ownerLabel,
    ownerSlackId,
  });
  if (flagDetail) {
    const { error: flagError } = await supabase.from("mod_actions").insert({
      user_id: session.userId,
      action: "double_dip_flag",
      detail: flagDetail,
      actor: "system",
    });
    if (flagError) console.error("[projects] double dip log failed", flagError);
  }

  const { data, error: updateError } = await supabase
    .from("projects")
    .update({
      status: "shipped",
      shipped_at: new Date().toISOString(),
      // A fix-and-reship after needs_changes already went through a first
      // pass once - it jumps the queue instead of sorting by this fresh
      // shipped_at like a brand-new submission would (same reverted_at
      // priority the dashboard's "send back to review" admin action uses,
      // see listShippedProjects in apps/dashboard/lib/db.ts). A first-ever
      // ship (draft) or an update to an already-approved project waits its
      // turn normally.
      reverted_at: project.status === "needs_changes" ? new Date().toISOString() : null,
      review_note: "",
      review_note_by: "",
      rejected_at: null,
      reject_reason: "",
      reject_by: "",
      hackatime_seconds: trackedSeconds,
      is_update: isUpdate,
      update_notes: isUpdate ? updateNotes : "",
      ship_note: shipNote,
      other_ysws: otherYsws,
      other_ysws_notes: userDisclosedOtherYsws ? otherYswsNotes : "",
      system_note: systemNote,
      sidequest_id: sidequestId,
      eligibility_attested: true,
      // airtable_record_id points at the row from this project's LAST
      // approval. Left alone, the dashboard's Airtable push (actions.ts:
      // pushProjectToAirtable) reuses that id forever and an update ship's
      // eventual re-approval overwrites the original ship's row instead of
      // getting its own - clear it here so a genuine update starts fresh.
      ...(isUpdate ? { airtable_record_id: null } : {}),
    })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (updateError) {
    console.error("[projects] ship failed", updateError);
    return res.status(500).json({ ok: false });
  }
  try {
    await recordShipForOperations(id, session.userId);
  } catch (e) {
    console.error("[projects] operation ship record failed", (e as Error)?.message ?? e);
  }
  void addNotification(
    session.userId,
    isUpdate ? "Update shipped" : "Project shipped",
    `"${project.name}" is in the review queue. You'll hear back here once it's reviewed.`,
  );
  void postShipToSlack(data, ownerSlackId, trackedSeconds, isUpdate);
  res.json({ ok: true, project: toPlayerProject(data) });
});

// Withdraw a project from the review queue back to a draft so the owner can
// edit it. Only allowed before any human has weighed in ("shipped" = waiting
// for first pass, untouched) - NOT once it's in second_review/fraud_review,
// since by then a first-pass reviewer has already proposed a verdict
// (possibly a ban) and this update doesn't clear first_pass_* fields. Letting
// a maker unship+reship from that stage let them silently dodge a pending
// ban proposal: status reset to "shipped" (reshippable) while the stale
// first_pass_verdict stuck around, confusing the next reviewer instead of
// escalating to them. Found via project #176, 2026-08-25.
router.post("/api/projects/:id/unship", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return res.status(404).json({ ok: false });
  if (project.status !== "shipped")
    return res.status(400).json({ ok: false, error: "not_in_review" });

  const { data, error } = await supabase
    .from("projects")
    .update({
      status: "draft",
      shipped_at: null,
      review_note: "",
      review_note_by: "",
      reviewing_by: "",
      reviewing_at: null,
    })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (error) {
    console.error("[projects] unship failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, project: toPlayerProject(data) });
});

// Settle an approved Trial ship: the prize, or the pixels the payout math held
// back at approval. One or the other, once, and only by the owner - the review
// deliberately credits nothing until this lands (see reviewProject in the
// dashboard). Conditioning the update on trial_reward_choice still being
// 'pending' is what stops a double-click paying both sides.
router.post("/api/projects/:id/trial-reward", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  const choice = String(req.body?.choice ?? "");
  if (choice !== "item" && choice !== "pixels")
    return res.status(400).json({ ok: false, error: "bad_choice" });

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, status, approved_hours, sidequest_id, trial_reward_choice, trial_held_px, trial_prize_px")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!project) return res.status(404).json({ ok: false });
  if (project.status !== "approved" || project.trial_reward_choice !== "pending")
    return res.status(400).json({ ok: false, error: "nothing_to_claim" });

  // A Trial can be deleted out from under an approved ship (it has happened,
  // see [[trial-npc-link-drift]]). That must not strand the player's pixels, so
  // only the prize branch actually needs the row.
  const { data: trial } = await supabase
    .from("sidequests")
    .select("id, name, reward, prize_shop_item_id")
    .eq("id", project.sidequest_id as number)
    .maybeSingle();
  if (!trial && choice === "item")
    return res.status(400).json({ ok: false, error: "trial_missing" });
  const trialLabel = (trial?.name as string) || "this Trial";

  // Claim the choice first. If someone else's request already took it, this
  // matches no rows and we stop before paying anything out.
  const { data: claimed } = await supabase
    .from("projects")
    .update({ trial_reward_choice: choice })
    .eq("id", id)
    .eq("user_id", session.userId)
    .eq("trial_reward_choice", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return res.status(409).json({ ok: false, error: "already_claimed" });

  const heldPx = Math.max(Number(project.trial_held_px) || 0, 0);
  // The prize covers the Trial's minimum hours; those pixels (trial_prize_px)
  // are what you forfeit by keeping the prize. Everything beyond the minimum is
  // paid in pixels either way.
  const prizePx = Math.max(Number(project.trial_prize_px) || 0, 0);
  const beyondPx = Math.max(heldPx - prizePx, 0);

  if (choice === "pixels") {
    const { error } = await supabase.rpc("credit_project_pixels", {
      p_user_id: session.userId,
      p_project_id: id,
      p_amount: heldPx,
      p_hours: Number(project.approved_hours) || 0,
      p_created_by: "trial_reward",
    });
    if (error) {
      console.error("[projects] trial pixels payout failed", error);
      await supabase.from("projects").update({ trial_reward_choice: "pending" }).eq("id", id);
      return res.status(500).json({ ok: false });
    }
    void addNotification(
      session.userId,
      "Trial reward: pixels",
      `You took the pixels for "${trialLabel}". ${heldPx} pixels are in your wallet.`,
    );
    return res.json({ ok: true, choice, pixels: heldPx });
  }

  // The prize itself walks the same fulfilment pipeline as anything bought
  // with pixels - its price is prizePx, the pixels the player forfeits (never
  // credited) by keeping the item instead of taking the "pixels" choice
  // above, not 0. Fulfillment's budget math and the shop economy summary
  // both read this column directly, so a literal 0 here would make the
  // physical prize look free to source and undercount what was really
  // redeemed. Prefers the Trial's linked catalog item, falls back to its
  // free-text reward as a custom order ops fulfils by hand.
  let itemId: number | null = null;
  let itemName = (trial.reward as string) || (trial.name as string);
  if (trial.prize_shop_item_id) {
    const { data: prizeItem } = await supabase
      .from("shop_items")
      .select("id, name")
      .eq("id", trial.prize_shop_item_id)
      .maybeSingle();
    if (prizeItem) {
      itemId = prizeItem.id as number;
      itemName = prizeItem.name as string;
    }
  }
  const { data: order, error: orderError } = await supabase
    .from("shop_orders")
    .insert({
      user_id: session.userId,
      item_id: itemId,
      item_name: itemName,
      option: `Trial: ${trial.name}`,
      price: prizePx,
      status: "pending",
    })
    .select("id")
    .single();
  if (orderError || !order) {
    console.error("[projects] trial prize order failed", orderError);
    await supabase.from("projects").update({ trial_reward_choice: "pending" }).eq("id", id);
    return res.status(500).json({ ok: false });
  }
  await supabase.from("projects").update({ trial_prize_order_id: order.id }).eq("id", id);
  // Keeping the prize still pays out the pixels for hours past the minimum.
  if (beyondPx > 0) {
    const { error: pxError } = await supabase.rpc("credit_project_pixels", {
      p_user_id: session.userId,
      p_project_id: id,
      p_amount: beyondPx,
      p_hours: Number(project.approved_hours) || 0,
      p_created_by: "trial_reward",
    });
    if (pxError) console.error("[projects] trial beyond-min pixels payout failed", pxError);
  }
  void addNotification(
    session.userId,
    "Trial reward claimed",
    beyondPx > 0
      ? `"${itemName}" is on its way for finishing "${trial.name}", plus ${beyondPx} pixels for the hours past the minimum. Track the prize in your orders.`
      : `"${itemName}" is on its way for finishing "${trial.name}". Track it in your orders.`,
  );
  res.json({ ok: true, choice, item: itemName, pixels: beyondPx });
});

// True for the project's owner, or an accepted collaborator (view/log-hours
// only , journal and timeline reads/writes are gated on this; edit/ship/
// unship/delete stay owner-only via their own direct .eq("user_id", ...)).
async function canAccessProject(userId: string, projectId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[projects] ownership check failed", error);
    return false;
  }
  if (data !== null) return true;

  const { data: collab } = await supabase
    .from("project_collaborators")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("status", "accepted")
    .maybeSingle();
  return collab !== null;
}

// List journal entries for a project the caller owns or collaborates on,
// newest first.
router.get("/api/projects/:id/journal", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await canAccessProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const { data, error } = await supabase
    .from("project_journals")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[projects] journal list failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, entries: data ?? [] });
});

// Total tracked hours for a project. For the owner: their Hackatime since
// cutoff + everyone's journal hours. For an accepted collaborator viewing
// their own project page: THEIR linked Hackatime projects (on their own
// account) + their own journal hours, not the owner's , a collaborator's own
// Hackatime link would otherwise never show up as tracked time anywhere.
router.get("/api/projects/:id/hours", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await canAccessProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const { data: project } = await supabase
    .from("projects")
    .select("user_id, hackatime_projects, hours_extended_since")
    .eq("id", id)
    .single();
  if (!project) return res.status(404).json({ ok: false });

  const isOwner = project.user_id === session.userId;
  let linked: string[];
  let hackatimeSlackId: string | null;
  let hackatimeToken: string | null;
  let journalQuery = supabase.from("project_journals").select("hours").eq("project_id", id);

  if (isOwner) {
    const { data: owner } = await supabase
      .from("users")
      .select("hackatime_token, slack_id")
      .eq("id", project.user_id as string)
      .single();
    linked = (project.hackatime_projects as string[]) ?? [];
    hackatimeSlackId = (owner as { slack_id?: string } | null)?.slack_id ?? null;
    hackatimeToken = (owner as { hackatime_token?: string } | null)?.hackatime_token ?? null;
  } else {
    const [{ data: collab }, { data: viewer }] = await Promise.all([
      supabase
        .from("project_collaborators")
        .select("hackatime_projects")
        .eq("project_id", id)
        .eq("user_id", session.userId)
        .eq("status", "accepted")
        .maybeSingle(),
      supabase.from("users").select("hackatime_token, slack_id").eq("id", session.userId).single(),
    ]);
    linked = (collab?.hackatime_projects as string[]) ?? [];
    hackatimeSlackId = (viewer as { slack_id?: string } | null)?.slack_id ?? null;
    hackatimeToken = (viewer as { hackatime_token?: string } | null)?.hackatime_token ?? null;
    journalQuery = journalQuery.eq("user_id", session.userId);
  }

  const [hackatimeSeconds, { data: jrows }] = await Promise.all([
    fetchTrackedSecondsSince(
      hackatimeSlackId,
      hackatimeToken,
      linked,
      // The extension was granted on the owner's hours; collaborators keep
      // the default cutoff for their own.
      isOwner ? projectCutoffUnix(project.hours_extended_since as string | null) : undefined,
    ),
    journalQuery,
  ]);
  const journalSeconds = Math.round(
    ((jrows ?? []) as { hours: number | null }[]).reduce(
      (s, j) => s + (Number(j.hours) || 0),
      0,
    ) * 3600,
  );

  res.json({
    ok: true,
    hackatimeSeconds,
    journalSeconds,
    trackedSeconds: hackatimeSeconds + journalSeconds,
  });
});

// Player-visible history for an own project: creation, current ship, and each
// review verdict with its player-facing note. Internal audit notes are never
// exposed here.
router.get("/api/projects/:id/timeline", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await canAccessProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const [{ data: proj }, { data: audits }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "created_at, shipped_at, status, first_pass_verdict, banned_at, robert_project_id, robert_submitted_at, robert_reviewed_at",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("review_audits")
      .select("verdict, note, claimed_hours, approved_hours, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
  ]);

  // Same masking as toPlayerProject above - a proposed ban must look exactly
  // like an ordinary still-in-review ship until a different final reviewer
  // confirms or overturns it, not like a review already happened. !banned_at
  // matters here too - see the matching comment in toPlayerProject.
  const banProposalPending =
    (proj?.status === "second_review" || proj?.status === "fraud_review") &&
    proj?.first_pass_verdict === "banned" &&
    !proj?.banned_at;

  const events: Record<string, unknown>[] = [];
  if (proj?.created_at) events.push({ kind: "created", at: proj.created_at });
  for (const a of audits ?? []) {
    if (banProposalPending && a.verdict === "first_pass_banned") continue;
    events.push({
      kind: "review",
      at: a.created_at,
      verdict: a.verdict,
      note: a.note ?? "",
      claimedHours: a.claimed_hours ?? null,
      // Credited (possibly deflated) hours are only real once a project is
      // actually approved , first-pass hours are just a proposal until a
      // different second-pass reviewer confirms them, and a needs_changes
      // verdict isn't final either (the next review pass can land on a
      // different number). Showing either early spoils/misleads on what the
      // player will actually be credited, so redact both until "approved".
      approvedHours:
        a.verdict === "approved" ? (a.approved_hours ?? null) : null,
    });
  }
  if (proj?.shipped_at && ["shipped", "fraud_review", "second_review"].includes(proj.status))
    events.push({ kind: "shipped", at: proj.shipped_at });

  events.sort(
    (a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime(),
  );
  res.json({
    ok: true,
    events,
    status: banProposalPending ? "shipped" : (proj?.status ?? null),
    // Robert (the fraud pass) is optional per event , a project only ever
    // goes through it if it was actually submitted there.
    robertUsed: banProposalPending ? false : Boolean(proj?.robert_project_id),
    fraudReviewAt: banProposalPending ? null : (proj?.robert_submitted_at ?? null),
    fraudReviewDoneAt: banProposalPending ? null : (proj?.robert_reviewed_at ?? null),
  });
});

// Journals are what a reviewer reads to judge the hours, so they freeze the
// moment a project is in review (same set as IN_REVIEW in operations/domain.ts)
// and open back up on needs_changes/approved/draft.
async function journalLockedForReview(projectId: number): Promise<boolean> {
  const { data } = await supabase
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .maybeSingle();
  return ["shipped", "second_review", "fraud_review"].includes(String(data?.status ?? ""));
}

// How many images a journal entry's content needs, by the hours logged: at
// least 1 always (even a 0h entry), plus one more per 4h on top of that.
function journalImagesNeeded(hours: number): number {
  return Math.max(1, Math.ceil(hours / 4));
}

// Images are embedded as markdown image syntax (![alt](url)) by the client's
// IMAGE toolbar button (attachImageToJournal in apps/game/web/projects) , this
// just counts how many are actually in the saved content.
function countJournalImages(content: string): number {
  return (content.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
}

// Add a journal entry (markdown content + optional hours) to an own project.
router.post("/api/projects/:id/journal", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await canAccessProject(session.userId, id)))
    return res.status(404).json({ ok: false });
  if (await journalLockedForReview(id))
    return res.status(409).json({ ok: false, error: "project_in_review" });

  const content = String(req.body?.content ?? "").trim().slice(0, 5000);
  if (!content)
    return res.status(400).json({ ok: false, error: "content_required" });
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  let hours = Number(req.body?.hours ?? 0);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  hours = Math.min(Math.round(hours * 100) / 100, 100);

  // Entries that log time need substance: at least 100 characters per hour
  // (min 100 for any logged time), so "4h" can't be a one-liner.
  if (hours > 0) {
    const need = Math.max(100, Math.round(hours * 100));
    if (content.length < need)
      return res.status(400).json({ ok: false, error: "journal_too_short", need, hours });
  }
  const imagesNeed = journalImagesNeeded(hours);
  const imagesHave = countJournalImages(content);
  if (imagesHave < imagesNeed)
    return res
      .status(400)
      .json({ ok: false, error: "journal_images_required", need: imagesNeed, have: imagesHave, hours });

  const { data, error } = await supabase
    .from("project_journals")
    .insert({ project_id: id, user_id: session.userId, content, hours, title })
    .select()
    .single();
  if (error) {
    console.error("[projects] journal create failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, entry: data });
});

// Edit one of the user's own journal entries (owner-only, same as delete).
router.patch("/api/projects/:id/journal/:entryId", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  const entryId = Number(req.params.entryId);
  if (!Number.isFinite(id) || !Number.isFinite(entryId))
    return res.status(400).json({ ok: false });
  if (await journalLockedForReview(id))
    return res.status(409).json({ ok: false, error: "project_in_review" });

  const content = String(req.body?.content ?? "").trim().slice(0, 5000);
  if (!content)
    return res.status(400).json({ ok: false, error: "content_required" });
  const title = String(req.body?.title ?? "").trim().slice(0, 120);
  let hours = Number(req.body?.hours ?? 0);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  hours = Math.min(Math.round(hours * 100) / 100, 100);

  if (hours > 0) {
    const need = Math.max(100, Math.round(hours * 100));
    if (content.length < need)
      return res.status(400).json({ ok: false, error: "journal_too_short", need, hours });
  }
  const imagesNeed = journalImagesNeeded(hours);
  const imagesHave = countJournalImages(content);
  if (imagesHave < imagesNeed)
    return res
      .status(400)
      .json({ ok: false, error: "journal_images_required", need: imagesNeed, have: imagesHave, hours });

  const { data, error } = await supabase
    .from("project_journals")
    .update({ content, hours, title, edited_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("project_id", id)
    .eq("user_id", session.userId)
    .select()
    .maybeSingle();
  if (error) {
    console.error("[projects] journal edit failed", error);
    return res.status(500).json({ ok: false });
  }
  if (!data) return res.status(404).json({ ok: false });
  res.json({ ok: true, entry: data });
});

// Delete one of the user's own journal entries.
router.delete("/api/projects/:id/journal/:entryId", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  const entryId = Number(req.params.entryId);
  if (!Number.isFinite(id) || !Number.isFinite(entryId))
    return res.status(400).json({ ok: false });
  if (await journalLockedForReview(id))
    return res.status(409).json({ ok: false, error: "project_in_review" });

  const { error } = await supabase
    .from("project_journals")
    .delete()
    .eq("id", entryId)
    .eq("project_id", id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[projects] journal delete failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

// Delete one of the user's own projects.
router.delete("/api/projects/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) {
    console.error("[projects] delete failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

export default router;
