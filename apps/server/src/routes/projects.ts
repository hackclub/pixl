import { Router } from "express";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "./notifications.js";
import { findInYswsArchive } from "../ysws/archive.js";
import { buildDoubleDip } from "../ysws/doubleDip.js";
import { fetchHackatimeStats, fetchTrackedSecondsSince } from "../hackatime/api.js";

const router = Router();

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

// List the logged-in user's projects, newest first — their own plus any
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
      ...p,
      pixels_earned: earned.get(p.id as number) ?? 0,
      sidequest_name: p.sidequest_id
        ? (trialName.get(p.sidequest_id as number) ?? null)
        : null,
      trial_prize_name: p.sidequest_id
        ? (trialPrize.get(p.sidequest_id as number) ?? null)
        : null,
    })),
  });
});

function isGithubRepoUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
  return u.pathname.split("/").filter(Boolean).length >= 2;
}

// Players routinely paste a link without the scheme ("foo.itch.io/game"). Store
// it with https:// so it's a real URL — otherwise every liveness check (which
// does fetch(url)) throws and the ship is rejected as "unreachable".
function ensureProtocol(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

// A demo must be a playable page, not the source. A bare github.com/<user>/<repo>
// link is rejected; github *releases* pages are allowed (they host builds).
function normalizeDemoUrl(raw: string): { error: string } | { url: string } {
  const s = ensureProtocol(raw).slice(0, 500);
  if (!s) return { url: "" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "demo_invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "demo_invalid" };
  const host = u.hostname.replace(/^www\./, "");
  if (host === "github.com" && !/\/releases(\/|$)/.test(u.pathname))
    return { error: "demo_is_repo" };
  return { url: u.toString() };
}

// SSRF guard for the ship-time liveness checks. A player fully controls demo_url
// (any host is accepted by normalizeDemoUrl) and a repo link can redirect
// anywhere, so before we ever fetch() a player-supplied URL we make sure the
// host doesn't resolve to a loopback / private / link-local address — otherwise
// urlAlive becomes a probe for internal services and the cloud metadata IP.
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true; // loopback / unspecified
    if (s.startsWith("::ffff:")) return isBlockedIp(s.slice(7)); // IPv4-mapped
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local
    if (s.startsWith("fe80")) return true; // link-local
    return false;
  }
  return true; // not a parseable IP — refuse rather than guess
}

async function hostIsPublic(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return !isBlockedIp(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    // Reject if it doesn't resolve, or if ANY resolved address is internal.
    return addrs.length > 0 && addrs.every((a) => !isBlockedIp(a.address));
  } catch {
    return false;
  }
}

async function urlAlive(url: string): Promise<boolean> {
  // Follow redirects by hand so we can re-validate the host at every hop — a
  // public URL that 302s to http://169.254.169.254 must not slip through.
  // (Note: this does not close DNS-rebinding between the check and fetch's own
  // resolution; blocking literal internal targets and redirect chains is the
  // proportionate guard here.)
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!(await hostIsPublic(u.hostname))) return false;
    try {
      let r = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 405 || r.status === 501)
        r = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return false;
        current = new URL(loc, current).toString();
        continue;
      }
      return r.ok || r.status === 401 || r.status === 403;
    } catch {
      return false;
    }
  }
  return false; // too many redirects
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
  // Save accepts any URL , repo/demo are only validated at ship time, so people
  // can jot down a link and fix it up before shipping.
  const repoUrl = ensureProtocol(body?.repoUrl).slice(0, 500);
  const demoUrl = ensureProtocol(body?.demoUrl).slice(0, 500);
  const usedAi = body?.usedAi === true;
  const aiNotes = String(body?.aiNotes ?? "").trim().slice(0, 500);
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
  const bomUrl = needsFunding ? String(body?.bomUrl ?? "").trim().slice(0, 500) : "";
  const cartScreenshotUrls = needsFunding && Array.isArray(body?.cartScreenshotUrls)
    ? body.cartScreenshotUrls.map((u: unknown) => String(u)).slice(0, 10)
    : [];
  return {
    fields: {
      name,
      description: String(body?.description ?? "").trim().slice(0, 2000),
      repo_url: repoUrl,
      demo_url: demoUrl,
      image_url: String(body?.imageUrl ?? "").trim().slice(0, 500),
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
  res.json({ ok: true, project: data });
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
    .select("status, level, sidequest_id")
    .eq("id", id)
    .eq("user_id", session.userId)
    .maybeSingle();
  const fields: Record<string, unknown> = { ...parsed.fields };

  // Trial link is picked at creation and editable while the project is a draft.
  // Same acceptance rule as create: only a Trial the player has accepted links.
  const trial = await resolveTrialLink(session.userId, req.body?.sidequestId);
  if ("error" in trial) return res.status(400).json({ ok: false, error: trial.error });
  fields.sidequest_id = trial.id;

  // On an approved project, neither the tier nor the Trial link may change (both
  // feed payout/RE that already settled) — keep whatever the reviewer approved.
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
  res.json({ ok: true, project: data });
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
  if (!project.repo_url)
    return res.status(400).json({ ok: false, error: "repo_required" });
  if (!project.demo_url)
    return res.status(400).json({ ok: false, error: "demo_required" });
  if (!String(project.image_url ?? "").trim())
    return res.status(400).json({ ok: false, error: "image_required" });
  // Hard exclusion under Hack Club's YSWS "Project Exceptions" — school
  // assignments and paid Hack Club work can't go into the Unified Database.
  if (req.body?.eligibilityAttested !== true)
    return res.status(400).json({ ok: false, error: "eligibility_attestation_required" });
  // URLs are only validated here, at ship time (save accepts anything).
  if (!isGithubRepoUrl(project.repo_url as string))
    return res.status(400).json({ ok: false, error: "repo_not_github" });
  const demoCheck = normalizeDemoUrl(project.demo_url as string);
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

  const isHardware = project.kind === "hardware";

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

  const { data: userRow } = await supabase
    .from("users")
    .select("hackatime_token, slack_id")
    .eq("id", session.userId)
    .single();
  const htToken = (userRow as { hackatime_token?: string } | null)?.hackatime_token ?? null;
  const stats = await fetchHackatimeStats(htToken);
  // Software must have a working Hackatime connection; hardware treats Hackatime
  // as optional (journal hours can stand in), so a hardware ship never fails on
  // Hackatime being unavailable.
  if (!isHardware && !stats.connected && stats.error)
    return res.status(502).json({ ok: false, error: "hackatime_unavailable" });
  const linked = (project.hackatime_projects as string[]) ?? [];
  // Only hours logged from the cutoff onward count — see HACKATIME_CUTOFF.
  const htSeconds = await fetchTrackedSecondsSince(
    (userRow as { slack_id?: string } | null)?.slack_id ?? null,
    htToken,
    linked,
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
    journalSeconds = jhours * 3600;
  }
  const trackedSeconds = htSeconds + journalSeconds;
  if (trackedSeconds < 3600)
    return res.status(400).json({
      ok: false,
      error: isHardware ? "project_hours_required" : "hackatime_hours_required",
    });

  // Refresh each accepted collaborator's own tracked hours (their own
  // Hackatime account, filtered by the projects *they* linked) so review-time
  // crediting has up-to-date numbers per person. Purely informational — it
  // never gates whether this ship goes through.
  const { data: collaborators } = await supabase
    .from("project_collaborators")
    .select("id, user_id, hackatime_projects")
    .eq("project_id", id)
    .eq("status", "accepted");
  if (collaborators && collaborators.length > 0) {
    const collaboratorIds = collaborators.map((c) => c.user_id as string);
    const { data: collabUsers } = await supabase
      .from("users")
      .select("id, hackatime_token, slack_id")
      .in("id", collaboratorIds);
    const tokenFor = new Map(
      (collabUsers ?? []).map((u) => [u.id as string, u.hackatime_token as string | null]),
    );
    const slackFor = new Map(
      (collabUsers ?? []).map((u) => [u.id as string, u.slack_id as string | null]),
    );
    await Promise.all(
      collaborators.map(async (c) => {
        const collabLinked = (c.hackatime_projects as string[]) ?? [];
        const collabSeconds = await fetchTrackedSecondsSince(
          slackFor.get(c.user_id as string) ?? null,
          tokenFor.get(c.user_id as string) ?? null,
          collabLinked,
        );
        await supabase
          .from("project_collaborators")
          .update({ hackatime_seconds: collabSeconds })
          .eq("id", c.id);
      }),
    );
  }

  const isUpdate = project.status === "approved" && !project.rejected_at;
  const updateNotes = String(req.body?.updateNotes ?? "").trim().slice(0, 2000);
  const shipNote = String(req.body?.shipNote ?? "").trim().slice(0, 2000);
  if (isUpdate && !updateNotes)
    return res.status(400).json({ ok: false, error: "update_notes_required" });
  if (isUpdate && updateNotes.length < 100)
    return res.status(400).json({ ok: false, error: "update_notes_too_short" });
  const otherYsws = req.body?.otherYsws === true || !!project.imported_ysws_entry_id;

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

  const matched = await findInYswsArchive(
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
    matched,
    otherYsws,
    trackedSeconds,
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
      system_note: systemNote,
      sidequest_id: sidequestId,
      eligibility_attested: true,
    })
    .eq("id", id)
    .eq("user_id", session.userId)
    .select()
    .single();
  if (updateError) {
    console.error("[projects] ship failed", updateError);
    return res.status(500).json({ ok: false });
  }
  void addNotification(
    session.userId,
    isUpdate ? "Update shipped" : "Project shipped",
    `"${project.name}" is in the review queue. You'll hear back here once it's reviewed.`,
  );
  res.json({ ok: true, project: data });
});

// Withdraw a project from the review queue back to a draft so the owner can
// edit it. Only allowed while it's actually in review (shipped/second_review).
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
  if (!["shipped", "fraud_review", "second_review"].includes(project.status))
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
  res.json({ ok: true, project: data });
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

  // The prize itself: a $0 order, so it walks the same fulfilment pipeline as
  // anything bought with pixels. Prefers the Trial's linked catalog item, falls
  // back to its free-text reward as a custom order ops fulfils by hand.
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
      price: 0,
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
// only — journal and timeline reads/writes are gated on this; edit/ship/
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
// account) + their own journal hours, not the owner's — a collaborator's own
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
    .select("user_id, hackatime_projects")
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
    fetchTrackedSecondsSince(hackatimeSlackId, hackatimeToken, linked),
    journalQuery,
  ]);
  const journalSeconds =
    ((jrows ?? []) as { hours: number | null }[]).reduce(
      (s, j) => s + (Number(j.hours) || 0),
      0,
    ) * 3600;

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
        "created_at, shipped_at, status, joe_project_id, joe_submitted_at, joe_reviewed_at",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("review_audits")
      .select("verdict, note, claimed_hours, approved_hours, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const events: Record<string, unknown>[] = [];
  if (proj?.created_at) events.push({ kind: "created", at: proj.created_at });
  for (const a of audits ?? [])
    events.push({
      kind: "review",
      at: a.created_at,
      verdict: a.verdict,
      note: a.note ?? "",
      claimedHours: a.claimed_hours ?? null,
      // First-pass hours are only a proposal until a different second-pass
      // reviewer confirms them — don't leak that number to the player early.
      approvedHours: a.verdict?.startsWith("first_pass_") ? null : (a.approved_hours ?? null),
    });
  if (proj?.shipped_at && ["shipped", "fraud_review", "second_review"].includes(proj.status))
    events.push({ kind: "shipped", at: proj.shipped_at });

  events.sort(
    (a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime(),
  );
  res.json({
    ok: true,
    events,
    status: proj?.status ?? null,
    // Joe (the fraud pass) is optional per event — a project only ever goes
    // through it if it was actually submitted there.
    joeUsed: Boolean(proj?.joe_project_id),
    fraudReviewAt: proj?.joe_submitted_at ?? null,
    fraudReviewDoneAt: proj?.joe_reviewed_at ?? null,
  });
});

// Add a journal entry (markdown content + optional hours) to an own project.
router.post("/api/projects/:id/journal", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false });
  if (!(await canAccessProject(session.userId, id)))
    return res.status(404).json({ ok: false });

  const content = String(req.body?.content ?? "").trim().slice(0, 5000);
  if (!content)
    return res.status(400).json({ ok: false, error: "content_required" });
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

  const { data, error } = await supabase
    .from("project_journals")
    .insert({ project_id: id, user_id: session.userId, content, hours })
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

  const content = String(req.body?.content ?? "").trim().slice(0, 5000);
  if (!content)
    return res.status(400).json({ ok: false, error: "content_required" });
  let hours = Number(req.body?.hours ?? 0);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  hours = Math.min(Math.round(hours * 100) / 100, 100);

  if (hours > 0) {
    const need = Math.max(100, Math.round(hours * 100));
    if (content.length < need)
      return res.status(400).json({ ok: false, error: "journal_too_short", need, hours });
  }

  const { data, error } = await supabase
    .from("project_journals")
    .update({ content, hours, edited_at: new Date().toISOString() })
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
