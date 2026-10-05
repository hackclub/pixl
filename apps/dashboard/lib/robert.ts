// Robert (telescreen.hackclub.com) is the fraud-review desk: we submit a
// project after its first pass, their fraud reviewer scores it 1-10 with a
// note, and that score+note is what lands a project in Spot check now (see
// robertSync.ts). Every outbound call to Robert lives here. Joe's old
// equivalent (lib/joe.ts) is retired - see 0206_robert_fraud_review.sql.

const DEFAULT_BASE = "https://telescreen.hackclub.com/api/v1/ysws";

export interface RobertConfig {
  base: string;
  apiKey: string;
}

// Unset config leaves every first-pass-approved project parked in
// fraud_review indefinitely (visible, un-actionable) until a key is set -
// deliberate for the rollout: manual fraud triage is retired regardless of
// whether Robert is configured yet.
export function robertConfig(): RobertConfig | null {
  const apiKey = (process.env.ROBERT_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const base = (process.env.ROBERT_API_BASE ?? "").trim() || DEFAULT_BASE;
  return { base: base.replace(/\/+$/, ""), apiKey };
}

export function robertEnabled(): boolean {
  return robertConfig() !== null;
}

// shipped_at is refreshed on every ship, so a re-shipped project gets a
// fresh Robert record instead of colliding with its previous (possibly
// already-decided) one, while a retried POST within the same ship
// deduplicates to Robert's 200 response. Same scheme as Joe's
// organizerPlatformId.
export function robertExternalId(projectId: number, shippedAt: string | null): string {
  const ms = shippedAt ? Date.parse(shippedAt) : NaN;
  const seconds = Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  return `pixl-${projectId}-${seconds}`;
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export interface JournalEntryInput {
  title: string;
  content: string;
  loggedAt: string;
  hours: number | null;
}

export interface SubmittableProject {
  id: number;
  name: string;
  kind: "software" | "hardware";
  codeUrl: string | null;
  demoUrl: string | null;
  hackatimeProjects: string[] | null;
  journal: JournalEntryInput[];
  shippedAt: string | null;
}

export interface SubmittableOwner {
  slackId: string | null;
}

export interface RobertSubmission {
  name: string;
  kind: "hackatime" | "hardware";
  codeUrl: string;
  demoUrl?: string;
  submitter: { slackId: string };
  hackatimeProjects?: string[];
  journal?: { title: string; content: string; loggedAt: string; hours?: number }[];
  externalId: string;
}

export type BuildResult = { ok: true; body: RobertSubmission } | { ok: false; error: string };

export function buildSubmission(
  project: SubmittableProject,
  owner: SubmittableOwner,
): BuildResult {
  const codeUrl = clean(project.codeUrl);
  if (!codeUrl) return { ok: false, error: "project has no code link" };

  const slackId = clean(owner.slackId);
  if (!slackId) return { ok: false, error: "submitter has no slack id" };

  const demoUrl = clean(project.demoUrl);
  const externalId = robertExternalId(project.id, project.shippedAt);

  if (project.kind === "hardware") {
    if (project.journal.length === 0)
      return { ok: false, error: "hardware project has no journal entries" };
    return {
      ok: true,
      body: {
        name: project.name,
        kind: "hardware",
        codeUrl,
        ...(demoUrl ? { demoUrl } : {}),
        submitter: { slackId },
        journal: project.journal.map((j) => ({
          title: j.title,
          content: j.content,
          loggedAt: j.loggedAt,
          ...(j.hours != null ? { hours: j.hours } : {}),
        })),
        externalId,
      },
    };
  }

  const hackatimeProjects = project.hackatimeProjects ?? [];
  if (hackatimeProjects.length === 0)
    return { ok: false, error: "project has no hackatime projects named" };
  return {
    ok: true,
    body: {
      name: project.name,
      kind: "hackatime",
      codeUrl,
      ...(demoUrl ? { demoUrl } : {}),
      submitter: { slackId },
      hackatimeProjects,
      externalId,
    },
  };
}

export interface RobertReview {
  trustScore: number;
  note: string;
  at: string;
}

export interface RobertOutcome {
  status: string;
  reason: string | null;
  trustScore: number;
  reviewedAt: string;
  reviewerName: string | null;
}

export interface RobertProject {
  id: string;
  externalId: string | null;
  state: string;
  review: RobertReview | null;
  outcome: RobertOutcome | null;
}

// Never throws. Callers store the error string and let the reconcile cron
// retry.
export async function submitProject(
  project: SubmittableProject,
  owner: SubmittableOwner,
): Promise<{ ok: true; robertProjectId: string } | { ok: false; error: string }> {
  const cfg = robertConfig();
  if (!cfg) return { ok: false, error: "robert is not configured" };

  const built = buildSubmission(project, owner);
  if (!built.ok) return built;

  try {
    const r = await fetch(`${cfg.base}/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `robert ${r.status}: ${text.slice(0, 300)}` };
    const json = JSON.parse(text) as { id?: string };
    const id = clean(json.id);
    if (!id) return { ok: false, error: `robert ${r.status}: no id in response` };
    return { ok: true, robertProjectId: id };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

// Bulk-lists every project Robert has scored but we haven't necessarily
// pulled yet (awaiting_outcome: score > 4, sitting for an organizer
// decision we never make on Robert's side; rejected_fraud: score <= 4,
// already final there). The reconcile cron matches these back to our rows
// by externalId.
export async function fetchScoredProjects(): Promise<RobertProject[]> {
  const cfg = robertConfig();
  if (!cfg) return [];
  // "decided" too: a score of 5-10 that a human already approved in Robert's
  // own UI lands here, and the webhook for that carries no review note (only
  // outcome.reason), so the reconcile cron reads it from this list instead.
  const states = ["awaiting_outcome", "rejected_fraud", "decided"] as const;
  const out: RobertProject[] = [];
  for (const state of states) {
    try {
      const r = await fetch(`${cfg.base}/projects?state=${state}&limit=100`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        console.error("robert fetchScoredProjects failed", state, r.status);
        continue;
      }
      const json = (await r.json()) as { projects?: RobertProject[] };
      if (Array.isArray(json.projects)) out.push(...json.projects);
    } catch (e) {
      console.error("robert fetchScoredProjects failed", state, (e as Error).message);
    }
  }
  return out;
}

// Pixl's own Spot check verdict, recorded back to Robert so its record
// stays accurate too. Never throws - a failed write-back doesn't block the
// verdict, it just leaves Robert's record stale.
export async function recordOutcome(
  robertProjectId: string,
  status: "approved" | "rejected",
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = robertConfig();
  if (!cfg) return { ok: false, error: "robert is not configured" };
  try {
    const r = await fetch(`${cfg.base}/projects/${robertProjectId}/outcome`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      // 409 here means Robert already has a final outcome (most commonly
      // the project was fraud-rejected there) - not worth logging as a
      // real failure, callers already guard against this via robert_state.
      if (r.status !== 409) console.error("robert recordOutcome failed", r.status, text.slice(0, 300));
      return { ok: false, error: `robert ${r.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("robert recordOutcome failed", (e as Error).message);
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}
