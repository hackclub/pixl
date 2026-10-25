import { sql } from "@/lib/pgCompat";
import { config, payoutUsdPerHour, reForHours, reForProject } from "@/app/_generated/config";

const num = (v: unknown) => Number(v ?? 0) || 0;
const roundCents = (dollars: number) => Math.round(dollars * 100);
const RATE = config.economy.pixelValueUsd;

export interface PendingProjectBudgetRow {
  id: number;
  name: string;
  status: string;
  kind: string;
  ownerSlackId: string;
  hours: number;
  additionalHours: number;
  tier: number;
  estimatedRateUsd: number;
  estimatedPayoutCents: number;
  sponsorValueCents: number;
  contributorCount: number;
  heldForTrial: boolean;
  hasProposedBan: boolean;
}

export interface PaidProjectBudgetRow {
  projectId: number;
  name: string;
  slackId: string;
  hours: number;
  paidPx: number;
  effectiveUsdPerHour: number | null;
}

export interface ProjectBudgetData {
  pendingProjects: PendingProjectBudgetRow[];
  reviewProjectCount: number;
  pendingHours: number;
  sponsorValueCents: number;
  estimatedRewardCents: number;
  trialContingentCount: number;
  paidProjects: PaidProjectBudgetRow[];
}

export function candidateProjectHours(input: {
  kind: string;
  trackedSeconds: number;
  journalHours: number;
  ownerRawJournalHours: number;
  firstPassHours: number | null;
  status: string;
  firstPassVerdict: string | null;
}): number {
  if (input.firstPassHours !== null && input.status !== "shipped" && input.firstPassVerdict === "approved")
    return Math.max(0, input.firstPassHours);
  const tracked = Math.max(0, num(input.trackedSeconds) / 3600);
  const hours = input.kind === "hardware"
    ? Math.max(0, tracked - num(input.ownerRawJournalHours)) + num(input.journalHours)
    : tracked + num(input.journalHours);
  return Math.round(Math.max(0, hours) * 10) / 10;
}

export function estimatedOutstandingPx(
  hours: number, rateUsd: number, fundingUsd: number, previouslyPaidPx: number,
): number {
  const gross = Math.round(Math.max(0, hours) * rateUsd / RATE);
  const funding = Math.min(gross, Math.round(Math.max(0, fundingUsd) / RATE));
  return Math.max(0, gross - funding - Math.max(0, previouslyPaidPx));
}

export async function getProjectBudgetData(query: typeof sql = sql): Promise<ProjectBudgetData> {
  const [waiting, collaborators, lifetime, previous, paid] = await Promise.all([
    query<{
      id: string; name: string; status: string; kind: string; level: string; user_id: string;
      slack_id: string | null; hackatime_seconds: string | null; first_pass_hours: string | null;
      first_pass_verdict: string | null; prior_approved_hours: string | null;
      funding_usd: string | null; needs_funding: boolean; sidequest_id: string | null;
      trial_reward_choice: string | null; journal_hours: string; owner_raw_journals: string;
    }[]>`
      SELECT p.id::text, p.name, p.status, p.kind, p.level::text, p.user_id::text,
        u.slack_id, p.hackatime_seconds::text, p.first_pass_hours::text,
        p.first_pass_verdict, p.prior_approved_hours::text, p.funding_usd::text,
        p.needs_funding, p.sidequest_id::text, p.trial_reward_choice,
        COALESCE(j.total_hours, 0)::text AS journal_hours,
        COALESCE(j.owner_raw_hours, 0)::text AS owner_raw_journals
      FROM projects p
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(j.approved_hours, j.hours)) AS total_hours,
          SUM(j.hours) FILTER (WHERE j.user_id = p.user_id) AS owner_raw_hours
        FROM project_journals j WHERE j.project_id = p.id
      ) j ON TRUE
      WHERE p.status IN ('shipped', 'second_review', 'fraud_review')
        AND p.banned_at IS NULL AND p.archived_at IS NULL AND p.rejected_at IS NULL
      ORDER BY p.shipped_at DESC NULLS LAST
    `,
    query<{
      project_id: string; user_id: string; approved_hours: string | null;
      prior_approved_hours: string | null; hackatime_seconds: string | null;
      journal_hours: string;
    }[]>`
      SELECT c.project_id::text, c.user_id::text, c.approved_hours::text,
        c.prior_approved_hours::text, c.hackatime_seconds::text,
        COALESCE(j.hours, 0)::text AS journal_hours
      FROM project_collaborators c
      JOIN projects p ON p.id = c.project_id
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(approved_hours, hours)) AS hours
        FROM project_journals WHERE project_id = c.project_id AND user_id = c.user_id
      ) j ON TRUE
      WHERE c.status = 'accepted'
        AND p.status IN ('shipped', 'second_review', 'fraud_review')
        AND p.banned_at IS NULL AND p.archived_at IS NULL AND p.rejected_at IS NULL
    `,
    query<{
      id: string; user_id: string; approved_hours: string | null; hackatime_seconds: string | null;
      level: string; sidequest_id: string | null;
    }[]>`
      SELECT id::text, user_id::text, approved_hours::text,
        hackatime_seconds::text, level::text, sidequest_id::text
      FROM projects WHERE status = 'approved' AND banned_at IS NULL
    `,
    query<{ project_id: string; user_id: string; paid_px: string }[]>`
      SELECT t.project_id::text, t.user_id::text, SUM(t.amount)::text AS paid_px
      FROM pixel_transactions t
      JOIN projects p ON p.id = t.project_id
      WHERE t.reason IN ('project_approved', 'review_reverted')
        AND p.status IN ('shipped','second_review','fraud_review')
      GROUP BY t.project_id, t.user_id
    `,
    query<{
      project_id: string; name: string; slack_id: string | null;
      paid_px: string; credited_hours: string;
    }[]>`
      SELECT p.id::text AS project_id, p.name, u.slack_id,
        SUM(t.amount)::text AS paid_px,
        COALESCE(NULLIF(MAX(t.hours), 0),
          CASE WHEN t.user_id = p.user_id
            THEN p.approved_hours ELSE c.approved_hours END, 0)::text AS credited_hours
      FROM pixel_transactions t
      JOIN projects p ON p.id = t.project_id
      JOIN users u ON u.id = t.user_id
      LEFT JOIN project_collaborators c ON c.project_id = p.id AND c.user_id = t.user_id
      WHERE t.reason IN ('project_approved', 'review_reverted') AND p.status = 'approved'
      GROUP BY p.id, p.name, u.slack_id, t.user_id, p.user_id, p.approved_hours, c.approved_hours
      ORDER BY MAX(t.created_at) DESC
      LIMIT 75
    `,
  ]);

  const reByUser = new Map<string, number>();
  for (const p of lifetime) {
    const hours = p.approved_hours !== null ? num(p.approved_hours) : num(p.hackatime_seconds) / 3600;
    reByUser.set(p.user_id, (reByUser.get(p.user_id) ?? 0) +
      reForProject(hours, Math.max(1, Math.min(4, num(p.level) || 1)), p.sidequest_id !== null));
  }
  const already = new Map<string, number>();
  for (const r of previous) already.set(r.project_id + ":" + r.user_id, num(r.paid_px));

  const collabByProject = new Map<number, Array<(typeof collaborators)[number]>>();
  for (const c of collaborators) {
    const id = num(c.project_id);
    const rows = collabByProject.get(id) ?? [];
    rows.push(c);
    collabByProject.set(id, rows);
  }

  const pendingProjects = waiting.map((p): PendingProjectBudgetRow => {
    const tier = Math.max(1, Math.min(4, num(p.level) || 1));
    const hours = candidateProjectHours({
      kind: p.kind, trackedSeconds: num(p.hackatime_seconds),
      journalHours: num(p.journal_hours), ownerRawJournalHours: num(p.owner_raw_journals),
      firstPassHours: p.first_pass_hours === null ? null : num(p.first_pass_hours),
      status: p.status, firstPassVerdict: p.first_pass_verdict,
    });
    const baseRe = reByUser.get(p.user_id) ?? 0;
    const rate = payoutUsdPerHour(baseRe + reForHours(hours, tier));
    const oldPx = already.get(p.id + ":" + p.user_id) ?? 0;
    const fundingUsd = p.needs_funding ? num(p.funding_usd) : 0;
    const ownerOutstanding = estimatedOutstandingPx(hours, rate, fundingUsd, oldPx);
    const ownerAdditionalHours = Math.max(0, hours - num(p.prior_approved_hours));
    let extraPx = ownerOutstanding;
    let totalHours = ownerAdditionalHours;
    let contributorCount = 1;
    for (const c of collabByProject.get(num(p.id)) ?? []) {
      const cHours = Math.max(0, c.approved_hours !== null
        ? num(c.approved_hours)
        : num(c.hackatime_seconds) / 3600 + num(c.journal_hours));
      const cRe = reByUser.get(c.user_id) ?? 0;
      const cRate = payoutUsdPerHour(cRe + reForHours(cHours, tier));
      extraPx += estimatedOutstandingPx(cHours, cRate, 0,
        already.get(p.id + ":" + c.user_id) ?? 0);
      totalHours += Math.max(0, cHours - num(c.prior_approved_hours));
      contributorCount++;
    }
    const hasProposedBan = p.first_pass_verdict === "banned";
    const heldForTrial = p.sidequest_id !== null && p.trial_reward_choice !== "pixels";
    return {
      id: num(p.id), name: p.name, status: p.status, kind: p.kind,
      ownerSlackId: p.slack_id ?? "", hours, additionalHours: totalHours, tier,
      estimatedRateUsd: rate,
      estimatedPayoutCents: hasProposedBan ? 0 : roundCents(extraPx * RATE),
      sponsorValueCents: hasProposedBan ? 0 : roundCents(totalHours * config.economy.sponsorRateUsd),
      contributorCount, heldForTrial, hasProposedBan,
    };
  });

  return {
    pendingProjects, reviewProjectCount: pendingProjects.length,
    pendingHours: pendingProjects.reduce((s, p) => s + (p.hasProposedBan ? 0 : p.additionalHours), 0),
    sponsorValueCents: pendingProjects.reduce((s, p) => s + p.sponsorValueCents, 0),
    estimatedRewardCents: pendingProjects.reduce((s, p) => s + p.estimatedPayoutCents, 0),
    trialContingentCount: pendingProjects.filter((p) => p.heldForTrial).length,
    paidProjects: paid.map((p) => {
      const hours = num(p.credited_hours), paidPx = num(p.paid_px);
      return {
        projectId: num(p.project_id), name: p.name, slackId: p.slack_id ?? "",
        hours, paidPx,
        effectiveUsdPerHour: hours > 0 ? Math.round((paidPx * RATE / hours) * 100) / 100 : null,
      };
    }),
  };
}