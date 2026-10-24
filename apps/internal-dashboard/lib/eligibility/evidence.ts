import { sql } from "../pgCompat";
import { fetchSubmissionStates, type SubmissionLookup } from "../airtable";
import { config } from "@/app/_generated/config";
import {
  evaluateEligibility,
  type AirtableState,
  type EligibilityResult,
  type EvidenceMeta,
  type LedgerEntry,
  type OrderInput,
  type PriorGrant,
  type ProjectEvidence,
  type ReviewerEarningsEvidence,
  type ReviewerLedgerState,
  type UnifiedState,
} from "./engine";
import { matchShips, type UnifiedMapping } from "./shipsMatch";
import { repoKeyOf, type ShipsProvider, type ShipsView } from "./ships";
import { currentPolicy, FUNDING_ORDER_PREFIX, type EligibilityPolicy } from "./policy";

export interface UnifiedVerifier {
  available: boolean;
  verify(refs: { projectId: number; userId: string; airtableRecordId: string | null }[]): Promise<Map<string, { state: UnifiedState; ref: string | null }>>;
}

export const unavailableUnifiedVerifier: UnifiedVerifier = {
  available: false,
  verify: async () => new Map(),
};

export type AirtableLookup = (ids: string[]) => Promise<Map<string, SubmissionLookup>>;

const AIRTABLE_CACHE_MS = 5 * 60 * 1000;
const airtableCache = new Map<string, { at: number; lookup: SubmissionLookup }>();

export function clearAirtableCache(): void {
  airtableCache.clear();
}

async function airtableLookups(ids: string[], live: boolean, lookup: AirtableLookup): Promise<Map<string, SubmissionLookup | null>> {
  const out = new Map<string, SubmissionLookup | null>();
  const need: string[] = [];
  for (const id of ids) {
    const c = airtableCache.get(id);
    if (c && Date.now() - c.at < AIRTABLE_CACHE_MS) out.set(id, c.lookup);
    else need.push(id);
  }
  if (need.length === 0) return out;
  if (!live) {
    for (const id of need) out.set(id, null);
    return out;
  }
  const got = await lookup(need);
  for (const id of need) {
    const l = got.get(id) ?? { kind: "error" as const, error: "no result" };
    out.set(id, l);
    if (l.kind !== "error") airtableCache.set(id, { at: Date.now(), lookup: l });
  }
  return out;
}

function airtableStateOf(l: SubmissionLookup | null | undefined): { state: AirtableState; ok: boolean } {
  if (l === null || l === undefined) return { state: "present", ok: true };
  if (l.kind === "found") return { state: l.info.submitted ? "submitted" : "present", ok: true };
  if (l.kind === "missing") return { state: "missing", ok: true };
  return { state: "unavailable", ok: false };
}

function mappingOf(stagingId: string | null, l: SubmissionLookup | null | undefined): UnifiedMapping {
  if (!stagingId) return { kind: "none" };
  if (l && l.kind === "found") {
    return l.info.unifiedId ? { kind: "mapped", stagingId, unifiedId: l.info.unifiedId } : { kind: "empty", stagingId };
  }
  if (l && l.kind === "missing") return { kind: "missing", stagingId };
  return { kind: "unavailable", stagingId };
}

const repoKey = repoKeyOf;

interface ProjectRow {
  id: number;
  name: string;
  user_id: string;
  status: string;
  approved_hours: string | number | null;
  banned_at: string | null;
  repo_url: string | null;
  airtable_record_id: string | null;
  system_note: string | null;
  funding_usd: string | number | null;
  needs_funding: boolean | null;
  funding_deducted_px: string | number | null;
  trial_reward_choice: string | null;
  trial_held_px: string | number | null;
  trial_prize_px: string | number | null;
  trial_prize_order_id: string | number | null;
  hours_deflated_at: string | null;
  prior_approved_hours: string | number | null;
}

interface CollabRow extends Omit<ProjectRow, "user_id" | "airtable_record_id" | "approved_hours"> {
  collab_user_id: string;
  collab_hours: string | number | null;
  collab_record_id: string | null;
  collab_prior_hours: string | number | null;
}

// A project mid-update or re-ship keeps its earlier approval: shipping freezes
// those hours in prior_approved_hours and clears the Airtable record id.
export function effectiveHours(
  status: string,
  approved: number,
  prior: number,
  recordId: string | null,
): { status: string; hours: number; prior: number; recordId: string | null } {
  if (status !== "approved" && status !== "rejected" && prior > 0) {
    return { status: "approved", hours: prior, prior: 0, recordId: null };
  }
  return { status, hours: approved, prior, recordId };
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type SqlLike = typeof sql;

async function ledgerFor(q: SqlLike, userIds: string[]): Promise<{ rows: LedgerEntry[]; ok: boolean }> {
  try {
    const rows = await q`
      select c.order_id, c.amount_cents
      from fulfillment_commitments c
      join shop_orders o on o.id = c.order_id
      where c.user_id in ${q(userIds)} and o.status <> 'cancelled'`;
    return { rows: rows.map((r) => ({ orderId: Number(r.order_id), amountCents: Number(r.amount_cents) })), ok: true };
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return { rows: [], ok: true };
    console.error("eligibility ledger", (e as Error).message);
    return { rows: [], ok: false };
  }
}

// Reviewer earnings are wallet transactions, not project payouts. These are
// the exact earning/correction reasons used by the reviewer payout code and
// the server's earnings ledger. review_payouts is read only to reconcile
// credited payouts marked voided; its paid_pixels are never added to funding.
const REVIEWER_CREDIT_REASONS = new Set(["review_payout", "review_payout_backfill"]);
const REVIEWER_CORRECTION_REASONS = new Set(["review_payout_voided", "review_payout_cut"]);

interface ReviewerTransactionRow {
  id: string | number | bigint | null;
  user_id: string | null;
  project_id: string | number | null;
  amount: string | number | null;
  reason: string | null;
}

interface ReviewerSettlementRow {
  id: string | number | bigint | null;
  reviewer_slack_id: string | null;
  status: string | null;
  full_pixels: string | number | null;
  paid_pixels: string | number | null;
  credited: boolean | null;
}

interface ReviewerAggregate {
  creditedPixels: number;
  correctionPixels: number;
  standardPayoutNetPixels: number;
  rows: number;
  state: ReviewerLedgerState;
}

function transactionId(value: ReviewerTransactionRow["id"]): string | null {
  if (typeof value === "bigint" && value > 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) {
    try {
      const id = BigInt(value);
      return id > 0n ? id.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

function reviewerEarningsFor(
  userIds: string[],
  rows: ReviewerTransactionRow[] | null,
  settlementRows: ReviewerSettlementRow[] | null,
  slackOf: Map<string, string | null>,
): Map<string, ReviewerEarningsEvidence> {
  const ids = new Set(userIds);
  const totals = new Map<string, ReviewerAggregate>(
    userIds.map((id) => [id, {
      creditedPixels: 0,
      correctionPixels: 0,
      standardPayoutNetPixels: 0,
      rows: 0,
      state: rows === null || settlementRows === null ? "unavailable" : "verified",
    }]),
  );
  if (rows === null) return new Map([...totals].map(([id, value]) => [id, value]));

  const seen = new Map<string, { userId: string; projectId: string | number | null; amount: number; reason: string | null }>();
  const markInconsistent = (userId?: string | null) => {
    if (userId && totals.has(userId)) {
      totals.get(userId)!.state = "inconsistent";
      return;
    }
    for (const value of totals.values()) value.state = "inconsistent";
  };

  for (const row of rows) {
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    if (!userId || !ids.has(userId)) {
      markInconsistent();
      continue;
    }
    const total = totals.get(userId)!;
    const id = transactionId(row.id);
    const amount = row.amount == null || String(row.amount).trim() === "" ? Number.NaN : Number(row.amount);
    if (!id || !Number.isSafeInteger(amount)) {
      total.state = "inconsistent";
      continue;
    }

    const prior = seen.get(id);
    if (prior) {
      if (
        prior.userId !== userId ||
        String(prior.projectId) !== String(row.project_id) ||
        prior.amount !== amount ||
        prior.reason !== row.reason
      ) {
        markInconsistent(prior.userId);
        markInconsistent(userId);
      }
      // A repeated result row for the same transaction id is one ledger row,
      // never a second source of funding.
      continue;
    }
    seen.set(id, { userId, projectId: row.project_id, amount, reason: row.reason });
    total.rows++;

    // adjust_user_pixels writes reviewer credits with project_id = NULL. A
    // project-linked reviewer reason is inconsistent, not extra project or
    // reviewer funding.
    if (row.project_id != null) {
      total.state = "inconsistent";
      continue;
    }
    if (row.reason && REVIEWER_CREDIT_REASONS.has(row.reason) && amount > 0) {
      const next = total.creditedPixels + amount;
      if (!Number.isSafeInteger(next)) total.state = "inconsistent";
      else total.creditedPixels = next;
      if (row.reason === "review_payout") {
        const nextStandard = total.standardPayoutNetPixels + amount;
        if (!Number.isSafeInteger(nextStandard)) total.state = "inconsistent";
        else total.standardPayoutNetPixels = nextStandard;
        if (!slackOf.get(userId)) total.state = "inconsistent";
      }
      continue;
    }
    if (row.reason && REVIEWER_CORRECTION_REASONS.has(row.reason) && amount < 0) {
      const next = total.correctionPixels + amount;
      if (!Number.isSafeInteger(next)) total.state = "inconsistent";
      else total.correctionPixels = next;
      if (row.reason === "review_payout_voided" || row.reason === "review_payout_cut") {
        const nextStandard = total.standardPayoutNetPixels + amount;
        if (!Number.isSafeInteger(nextStandard)) total.state = "inconsistent";
        else total.standardPayoutNetPixels = nextStandard;
        if (row.reason === "review_payout_voided" && !slackOf.get(userId)) total.state = "inconsistent";
      }
      continue;
    }
    // Zero-value rows and reason/sign mismatches cannot establish a payout.
    total.state = "inconsistent";
  }

  if (settlementRows !== null) {
    const usersBySlack = new Map<string, string>();
    const ambiguousSlackIds = new Set<string>();
    for (const [userId, slackId] of slackOf) {
      if (!slackId || !ids.has(userId)) continue;
      if (usersBySlack.has(slackId) && usersBySlack.get(slackId) !== userId) {
        ambiguousSlackIds.add(slackId);
        markInconsistent(usersBySlack.get(slackId));
        markInconsistent(userId);
      } else {
        usersBySlack.set(slackId, userId);
      }
    }

    const expectedActive = new Map<string, number>();
    const voidedUsers = new Set<string>();
    const seenSettlements = new Map<string, { userId: string; status: string | null; fullPixels: number; paidPixels: number; credited: boolean | null }>();
    for (const row of settlementRows) {
      const slackId = typeof row.reviewer_slack_id === "string" ? row.reviewer_slack_id : null;
      const userId = slackId && !ambiguousSlackIds.has(slackId) ? usersBySlack.get(slackId) : undefined;
      if (!userId) {
        markInconsistent();
        continue;
      }
      const id = transactionId(row.id);
      const fullPixels = row.full_pixels == null || String(row.full_pixels).trim() === "" ? Number.NaN : Number(row.full_pixels);
      const paidPixels = row.paid_pixels == null || String(row.paid_pixels).trim() === "" ? Number.NaN : Number(row.paid_pixels);
      if (!id || !Number.isSafeInteger(fullPixels) || fullPixels < 0 || !Number.isSafeInteger(paidPixels) || paidPixels < 0) {
        markInconsistent(userId);
        continue;
      }
      const prior = seenSettlements.get(id);
      if (prior) {
        if (
          prior.userId !== userId ||
          prior.status !== row.status ||
          prior.fullPixels !== fullPixels ||
          prior.paidPixels !== paidPixels ||
          prior.credited !== row.credited
        ) {
          markInconsistent(prior.userId);
          markInconsistent(userId);
        }
        continue;
      }
      seenSettlements.set(id, { userId, status: row.status, fullPixels, paidPixels, credited: row.credited });
      if (row.status === "voided") voidedUsers.add(userId);
      if (row.status !== "paid" || row.credited !== true) continue;
      const next = (expectedActive.get(userId) ?? 0) + paidPixels;
      if (!Number.isSafeInteger(next)) markInconsistent(userId);
      else expectedActive.set(userId, next);
    }

    for (const userId of userIds) {
      if (!voidedUsers.has(userId)) continue;
      const actualNetPixels = totals.get(userId)!.standardPayoutNetPixels;
      const expectedActivePixels = expectedActive.get(userId) ?? 0;
      if (actualNetPixels !== expectedActivePixels) markInconsistent(userId);
    }
  }

  return new Map([...totals].map(([id, value]) => [id, value]));
}

export interface PlayerEvidence {
  userId: string;
  projects: ProjectEvidence[];
  priorGrants: PriorGrant[];
  reviewerEarnings: ReviewerEarningsEvidence;
  orders: OrderInput[];
  ledger: LedgerEntry[];
  meta: EvidenceMeta;
}

export async function loadPlayerEvidence(
  userIds: string[],
  opts: { liveAirtable: boolean; verifier?: UnifiedVerifier; sql?: SqlLike; now?: number; ships?: ShipsProvider | ShipsView; airtable?: AirtableLookup } = { liveAirtable: false },
): Promise<Map<string, PlayerEvidence>> {
  const out = new Map<string, PlayerEvidence>();
  if (userIds.length === 0) return out;
  const verifier = opts.verifier ?? unavailableUnifiedVerifier;
  const loadedAt = opts.now ?? Date.now();
  const q = opts.sql ?? sql;

  const shipsView: ShipsView | null = !opts.ships ? null : "get" in opts.ships ? await opts.ships.get() : opts.ships;

  const [owned, collab, orders, ledger, audits, userRows, payoutRows, reviewerRows] = await Promise.all([
    q`select id, name, user_id, status, approved_hours, banned_at, repo_url, airtable_record_id, system_note, funding_usd, needs_funding, funding_deducted_px, trial_reward_choice, trial_held_px, trial_prize_px, trial_prize_order_id, hours_deflated_at, prior_approved_hours
        from projects where user_id in ${q(userIds)}`,
    q`select p.id, p.name, p.status, p.banned_at, p.repo_url, p.system_note, p.funding_usd, p.hours_deflated_at,
               c.user_id as collab_user_id, c.approved_hours as collab_hours, c.airtable_record_id as collab_record_id, c.prior_approved_hours as collab_prior_hours
        from project_collaborators c join projects p on p.id = c.project_id
        where c.status = 'accepted' and c.user_id in ${q(userIds)}`,
    q`select id, user_id, item_name, quantity, price, status, actual_cost_usd, flagged_at
        from shop_orders where user_id in ${q(userIds)}`,
    ledgerFor(q, userIds),
    q`select distinct on (project_id) project_id, claimed_hours
        from review_audits where verdict = 'hours_deflated' order by project_id, created_at asc`.catch(() => []),
    q`select id, slack_id from users where id in ${q(userIds)}`,
    q`select id, user_id, project_id, amount, hours, reason
        from pixel_transactions
        where user_id in ${q(userIds)} and project_id is not null and reason in ('project_approved', 'review_reverted')
        order by id`.catch((e: Error) => {
      console.error("eligibility payouts", e.message);
      return null;
    }),
    q`select id, user_id, project_id, amount, reason
        from pixel_transactions
        where user_id in ${q(userIds)}
          and reason in ('review_payout', 'review_payout_backfill', 'review_payout_voided', 'review_payout_cut')
        order by id`.catch((e: Error) => {
      console.error("eligibility reviewer payouts", e.message);
      return null;
    }),
  ]);
  const slackOf = new Map<string, string | null>(
    (userRows as unknown as { id: string; slack_id: string | null }[]).map((u) => [u.id, u.slack_id]),
  );
  const reviewerSlackIds = [...new Set([...slackOf.values()].filter((id): id is string => !!id))];
  let reviewerSettlementRows: ReviewerSettlementRow[] | null = [];
  if (reviewerSlackIds.length > 0) {
    try {
      reviewerSettlementRows = await q`
        select id, reviewer_slack_id, status, full_pixels, paid_pixels, credited
        from review_payouts
        where reviewer_slack_id in ${q(reviewerSlackIds)}
        order by id` as unknown as ReviewerSettlementRow[];
    } catch (e) {
      console.error("eligibility reviewer payout reconciliation", (e as Error).message);
      reviewerSettlementRows = null;
    }
  }
  const reviewerEarnings = reviewerEarningsFor(
    userIds,
    reviewerRows as unknown as ReviewerTransactionRow[] | null,
    reviewerSettlementRows,
    slackOf,
  );

  const originalHours = new Map<number, number>();
  for (const a of audits as unknown as { project_id: number; claimed_hours: string | number | null }[]) {
    if (a.claimed_hours != null) originalHours.set(Number(a.project_id), num(a.claimed_hours));
  }

  const raw: { p: ProjectEvidence; recordId: string | null }[] = [];
  for (const r of owned as unknown as ProjectRow[]) {
    const e = effectiveHours(r.status, num(r.approved_hours), num(r.prior_approved_hours), r.airtable_record_id);
    raw.push({
      recordId: e.recordId,
      p: {
        projectId: Number(r.id),
        userId: r.user_id,
        name: r.name,
        role: "owner",
        approvedHours: e.hours,
        originalHours: r.hours_deflated_at ? (originalHours.get(Number(r.id)) ?? null) : null,
        deflated: !!r.hours_deflated_at,
        status: e.status,
        banned: !!r.banned_at,
        repoKey: repoKey(r.repo_url),
        airtable: "none",
        airtableRecordId: e.recordId,
        unified: "unverifiable",
        unifiedRef: null,
        disputed: !!(r.system_note ?? "").trim(),
        priorApprovedHours: e.prior,
      },
    });
  }
  for (const r of collab as unknown as CollabRow[]) {
    const e = effectiveHours(r.status, num(r.collab_hours), num(r.collab_prior_hours), r.collab_record_id);
    raw.push({
      recordId: e.recordId,
      p: {
        projectId: Number(r.id),
        userId: r.collab_user_id,
        name: r.name,
        role: "collaborator",
        approvedHours: e.hours,
        originalHours: null,
        deflated: !!r.hours_deflated_at,
        status: e.status,
        banned: !!r.banned_at,
        repoKey: repoKey(r.repo_url),
        airtable: "none",
        airtableRecordId: e.recordId,
        unified: "unverifiable",
        unifiedRef: null,
        disputed: !!(r.system_note ?? "").trim(),
        priorApprovedHours: e.prior,
      },
    });
  }

  const history = new Map<string, { netPx: number; creditedHours: number; rows: number }>();
  for (const t of (payoutRows ?? []) as unknown as { user_id: string; project_id: number; amount: string | number; hours: string | number; reason: string }[]) {
    const key = `${t.user_id}:${Number(t.project_id)}`;
    const h = history.get(key) ?? { netPx: 0, creditedHours: 0, rows: 0 };
    h.netPx += num(t.amount);
    if (t.reason === "project_approved") {
      h.creditedHours = num(t.hours);
      h.rows++;
    }
    history.set(key, h);
  }
  const withheld = new Map<number, number>();
  for (const r of owned as unknown as ProjectRow[]) {
    const px = num(r.funding_deducted_px);
    if (r.needs_funding && px > 0) withheld.set(Number(r.id), px);
  }
  const prizes = new Map<number, number>();
  const allPrize = new Set<number>();
  const ownOrders = new Set((orders as unknown as { id: string | number; user_id: string }[]).map((o) => `${o.user_id}:${Number(o.id)}`));
  for (const r of owned as unknown as ProjectRow[]) {
    const px = num(r.trial_prize_px);
    if (r.trial_reward_choice !== "item" || r.trial_prize_order_id == null || px <= 0) continue;
    prizes.set(Number(r.id), px);
    if (num(r.trial_held_px) === px && ownOrders.has(`${r.user_id}:${Number(r.trial_prize_order_id)}`)) allPrize.add(Number(r.id));
  }
  for (const x of raw) {
    if (payoutRows === null) {
      x.p.payout = null;
      continue;
    }
    const h = history.get(`${x.p.userId}:${x.p.projectId}`);
    const owner = x.p.role === "owner";
    if (h) {
      x.p.payout = { ...h, withheldPx: owner ? (withheld.get(x.p.projectId) ?? 0) : 0, trialPrizePx: owner ? (prizes.get(x.p.projectId) ?? 0) : 0 };
    } else if (owner && allPrize.has(x.p.projectId) && x.p.status === "approved" && !x.p.banned && x.p.approvedHours > 0) {
      x.p.payout = { netPx: 0, withheldPx: 0, trialPrizePx: prizes.get(x.p.projectId)!, creditedHours: x.p.approvedHours, rows: 1 };
    } else {
      x.p.payout = null;
    }
  }

  let airtableOk = true;
  const approved = raw.filter((x) => x.p.status === "approved" && !x.p.banned);
  const uniqueIds = [...new Set(approved.map((x) => x.recordId).filter((x): x is string => !!x))];
  const lookups = await airtableLookups(uniqueIds, opts.liveAirtable || !!opts.airtable, opts.airtable ?? fetchSubmissionStates);
  for (const x of raw) {
    if (!x.recordId) continue;
    if (lookups.has(x.recordId)) {
      const s = airtableStateOf(lookups.get(x.recordId));
      x.p.airtable = s.state;
      if (!s.ok) airtableOk = false;
    } else {
      x.p.airtable = "present";
    }
  }

  if (shipsView) {
    const nowMs = loadedAt;
    const mappings = new Map<(typeof raw)[number], UnifiedMapping>();
    for (const x of raw) {
      if (x.p.status !== "approved" || x.p.banned) continue;
      const mapping = mappingOf(x.recordId, x.recordId ? lookups.get(x.recordId) : null);
      mappings.set(x, mapping);
      x.p.ships = matchShips(shipsView, { mapping, repoKey: x.p.repoKey, playerSlackId: slackOf.get(x.p.userId) ?? null }, nowMs);
    }
    const usage = new Map<string, number>();
    for (const m of mappings.values()) if (m.kind === "mapped") usage.set(m.unifiedId, (usage.get(m.unifiedId) ?? 0) + 1);
    for (const [x, m] of mappings) {
      if (m.kind === "mapped" && (usage.get(m.unifiedId) ?? 0) > 1) {
        x.p.ships = matchShips(shipsView, { mapping: { kind: "duplicate", stagingId: m.stagingId, unifiedId: m.unifiedId }, repoKey: x.p.repoKey, playerSlackId: null }, nowMs);
      }
    }
  }

  let unifiedAvailable = verifier.available || !!shipsView?.snapshot;
  if (verifier.available) {
    try {
      const verdicts = await verifier.verify(
        approved.map((x) => ({ projectId: x.p.projectId, userId: x.p.userId, airtableRecordId: x.recordId })),
      );
      for (const x of raw) {
        const v = verdicts.get(`${x.p.userId}:${x.p.projectId}`);
        if (v) {
          x.p.unified = v.state;
          x.p.unifiedRef = v.ref;
        }
      }
    } catch (e) {
      console.error("eligibility unified verify", (e as Error).message);
      unifiedAvailable = !!shipsView?.snapshot;
    }
  }

  const ordersByUser = new Map<string, OrderInput[]>();
  for (const o of orders as unknown as {
    id: number;
    user_id: string;
    item_name: string;
    quantity: number;
    price: number;
    status: string;
    actual_cost_usd: string | number | null;
    flagged_at: string | null;
  }[]) {
    const list = ordersByUser.get(o.user_id) ?? [];
    list.push({
      id: Number(o.id),
      userId: o.user_id,
      itemName: o.item_name,
      quantity: Number(o.quantity) || 1,
      pricePx: Number(o.price) || 0,
      status: o.status,
      actualCostUsd: o.actual_cost_usd == null ? null : num(o.actual_cost_usd),
      flagged: !!o.flagged_at,
    });
    ordersByUser.set(o.user_id, list);
  }

  const grantsByUser = new Map<string, PriorGrant[]>();
  for (const r of owned as unknown as ProjectRow[]) {
    const deductedPx = num(r.funding_deducted_px);
    if (!r.needs_funding || deductedPx <= 0 || r.status !== "approved" || r.banned_at) continue;
    const list = ordersByUser.get(r.user_id) ?? [];
    const named = list.filter((o) => o.itemName === `${FUNDING_ORDER_PREFIX}${r.name}`).sort((a, b) => a.id - b.id);
    const linked = named.filter((o) => o.grantProjectId == null);
    if (linked.length > 0) {
      linked.forEach((o, i) => {
        if (i === 0) {
          o.grantFaceUsd = num(r.funding_usd);
          o.grantProjectId = Number(r.id);
        } else {
          o.duplicateGrant = true;
        }
      });
      continue;
    }
    const strays = named.length > 0 || list.some(
      (o) => o.itemName.startsWith(FUNDING_ORDER_PREFIX) && !(owned as unknown as ProjectRow[]).some((p) => o.itemName === `${FUNDING_ORDER_PREFIX}${p.name}`),
    );
    const grants = grantsByUser.get(r.user_id) ?? [];
    grants.push({ projectId: Number(r.id), name: r.name, usd: num(r.funding_usd), deductedPx, ambiguous: strays });
    grantsByUser.set(r.user_id, grants);
  }

  const orderOwner = new Map<number, string>();
  for (const [uid, list] of ordersByUser) for (const o of list) orderOwner.set(o.id, uid);

  for (const uid of userIds) {
    const projects = raw.filter((x) => x.p.userId === uid).map((x) => x.p);
    const restrictions: string[] = [];
    if (projects.some((p) => p.banned)) restrictions.push("Player has a banned project.");
    out.set(uid, {
      userId: uid,
      projects,
      priorGrants: grantsByUser.get(uid) ?? [],
      reviewerEarnings: reviewerEarnings.get(uid) ?? { creditedPixels: 0, correctionPixels: 0, rows: 0, state: "unavailable" },
      orders: ordersByUser.get(uid) ?? [],
      ledger: ledger.rows.filter((l) => orderOwner.get(l.orderId) === uid),
      meta: {
        loadedAt,
        commitmentsKnown: ledger.ok,
        airtableAvailable: airtableOk,
        unifiedAvailable,
        restrictions,
        shipsAvailable: !!shipsView?.snapshot,
        shipsFetchedAt: shipsView?.fetchedAt ?? null,
        shipsError: shipsView?.error ?? null,
      },
    });
  }
  return out;
}

export function withGrantLink(ev: PlayerEvidence, order: OrderInput): OrderInput {
  const known = ev.orders.find((o) => o.id === order.id);
  return known
    ? { ...order, grantFaceUsd: known.grantFaceUsd, grantProjectId: known.grantProjectId, duplicateGrant: known.duplicateGrant }
    : order;
}

export function evaluateFromEvidence(
  ev: PlayerEvidence,
  order: OrderInput,
  policy: EligibilityPolicy = currentPolicy(),
  now: number = Date.now(),
): EligibilityResult {
  const linked = withGrantLink(ev, order);
  return evaluateEligibility({
    policy,
    pixelValueUsd: config.economy.pixelValueUsd,
    now,
    order: linked,
    playerOrders: ev.orders,
    ledger: ev.ledger,
    projects: ev.projects,
    reviewerEarnings: ev.reviewerEarnings,
    priorGrants: ev.priorGrants,
    meta: ev.meta,
  });
}

export function toOrderInput(o: {
  id: number;
  user_id: string;
  item_name: string;
  quantity: number;
  price: number;
  status: string;
  actual_cost_usd: number | null;
  flagged_at: string | null;
}): OrderInput {
  return {
    id: Number(o.id),
    userId: o.user_id,
    itemName: o.item_name,
    quantity: Number(o.quantity) || 1,
    pricePx: Number(o.price) || 0,
    status: o.status,
    actualCostUsd: o.actual_cost_usd == null ? null : Number(o.actual_cost_usd),
    flagged: !!o.flagged_at,
  };
}

export async function evaluateOrders(
  orders: Parameters<typeof toOrderInput>[0][],
  opts: { liveAirtable: boolean; verifier?: UnifiedVerifier; sql?: SqlLike; ships?: ShipsProvider | ShipsView; airtable?: AirtableLookup },
): Promise<Map<number, EligibilityResult>> {
  const evidence = await loadPlayerEvidence([...new Set(orders.map((o) => o.user_id))], opts);
  const results = new Map<number, EligibilityResult>();
  for (const o of orders) {
    const ev = evidence.get(o.user_id);
    if (ev) results.set(Number(o.id), evaluateFromEvidence(ev, toOrderInput(o)));
  }
  return results;
}
