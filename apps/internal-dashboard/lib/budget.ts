import { sql } from "@/lib/pgCompat";
import { BUDGET_CATEGORIES, summarizeBudget, type BudgetCategory, type Direction, type EntryState } from "./budgetMath";

export interface BudgetEntry {
  id: number;
  direction: Direction;
  category: BudgetCategory;
  amountCents: number;
  state: EntryState;
  title: string;
  description: string;
  evidenceUrl: string;
  occurredOn: string;
  createdBy: string;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface ReviewerBudgetRow {
  slackId: string;
  paidReviews: number;
  pendingReviews: number;
  recordedPaidPx: number;
  creditedPx: number;
  netWalletPx: number;
}

export interface BudgetData {
  ledgerAvailable: boolean;
  ledger: BudgetEntry[];
  incomeCents: number;
  manualExpensesCents: number;
  shopSpentCents: number;
  totalExpensesCents: number;
  recordedNetCents: number;
  plannedIncomeCents: number;
  plannedExpensesCents: number;
  hasRecordedIncome: boolean;
  categories: { category: BudgetCategory; totalCents: number; state: EntryState; count: number }[];
  shop: { ordersWithActualCost: number; redeemedPx: number; missingActualCost: number };
  reviewers: ReviewerBudgetRow[];
  reviewerPaidCount: number;
  reviewerPendingCount: number;
  reviewerNetPx: number;
  fulfillerNetPx: number;
  projectPayoutPx: number;
  reviewRates: { approved: number; changes: number } | null;
}

const number = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => v instanceof Date ? v.toISOString() : String(v ?? "");
const categoryKeys = new Set<string>(Object.keys(BUDGET_CATEGORIES));

// All money movements are in US dollars. Cash received is manually recorded;
// PIXL pixels are only displayed as in-game payouts / nominal value, not income.
export async function getBudgetData(): Promise<BudgetData> {
  const [shopRows, pixelRows, reviewerRows, walletReviewerRows, rateRows, exists] = await Promise.all([
    sql<{ spent_cents: string; orders: string; redeemed_px: string; missing_cost: string }[]>`
      SELECT COALESCE(SUM(ROUND(actual_cost_usd * 100)::bigint) FILTER
        (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL), 0)::text AS spent_cents,
        COUNT(*) FILTER (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL)::text AS orders,
        COALESCE(SUM(price) FILTER (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL),0)::text AS redeemed_px,
        COUNT(*) FILTER (WHERE status <> 'cancelled' AND status IN ('credited','shipped','done') AND actual_cost_usd IS NULL)::text AS missing_cost
      FROM shop_orders
    `,
    sql<{ project_px: string; fulfiller_px: string }[]>`
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE reason IN ('project_approved','review_reverted','operation_blackout','operation_blackout_reverted')), 0)::text AS project_px,
        COALESCE(SUM(amount) FILTER (WHERE reason = 'fulfillment_payout'),0)::text AS fulfiller_px
      FROM pixel_transactions
    `,
    sql<{ slack_id: string; paid_reviews: string; pending_reviews: string; paid_px: string; credited_px: string }[]>`
      SELECT reviewer_slack_id AS slack_id,
        COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_reviews,
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_reviews,
        COALESCE(SUM(paid_pixels) FILTER (WHERE status = 'paid'),0)::text AS paid_px,
        COALESCE(SUM(paid_pixels) FILTER (WHERE status = 'paid' AND credited = TRUE),0)::text AS credited_px
      FROM review_payouts
      GROUP BY reviewer_slack_id
    `,
    sql<{ slack_id: string; net_px: string }[]>`
      SELECT u.slack_id, COALESCE(SUM(t.amount),0)::text AS net_px
      FROM pixel_transactions t
      JOIN users u ON u.id = t.user_id
      WHERE t.reason IN ('review_payout','review_payout_backfill','review_payout_voided','review_payout_cut')
        AND u.slack_id IS NOT NULL
      GROUP BY u.slack_id
    `,
    sql<{ approved_pixels: string; needs_changes_pixels: string }[]>`
      SELECT approved_pixels, needs_changes_pixels
      FROM review_payout_settings ORDER BY updated_at DESC LIMIT 1
    `,
    sql<{ present: boolean }[]>`SELECT to_regclass('public.budget_entries') IS NOT NULL AS present`,
  ]);
  const shop = shopRows[0];
  const p = pixelRows[0];
  const walletMap = new Map(walletReviewerRows.map((x) => [x.slack_id, number(x.net_px)]));
  const reviewers = reviewerRows.map((r) => ({
    slackId: r.slack_id,
    paidReviews: number(r.paid_reviews),
    pendingReviews: number(r.pending_reviews),
    recordedPaidPx: number(r.paid_px),
    creditedPx: number(r.credited_px),
    netWalletPx: walletMap.get(r.slack_id) ?? 0,
  })).sort((a, b) => b.netWalletPx - a.netWalletPx);
  const reviewerNetPx = walletReviewerRows.reduce((s, r) => s + number(r.net_px), 0);

  const ledgerAvailable = exists[0]?.present === true;
  let categories: BudgetData["categories"] = [];
  let ledger: BudgetEntry[] = [];
  if (ledgerAvailable) {
    const [groups, recent] = await Promise.all([
      sql<{ category: string; direction: Direction; state: EntryState; amount_cents: string; n: string }[]>`
        SELECT category, direction, state, COALESCE(SUM(amount_cents),0)::text AS amount_cents, COUNT(*)::text AS n
        FROM budget_entries WHERE voided_at IS NULL
        GROUP BY category, direction, state
      `,
      sql<Record<string, unknown>[]>`
        SELECT id, direction, category, amount_cents, state, title, description,
          evidence_url, occurred_on, created_by, created_at, voided_at, voided_by, void_reason
        FROM budget_entries ORDER BY occurred_on DESC, id DESC LIMIT 100
      `,
    ]);
    categories = groups.filter((r) => categoryKeys.has(r.category)).map((r) => ({
      category: r.category as BudgetCategory,
      state: r.state,
      totalCents: number(r.amount_cents),
      count: number(r.n),
    }));
    ledger = recent.map((r) => ({
      id: number(r.id),
      direction: r.direction as Direction,
      category: r.category as BudgetCategory,
      amountCents: number(r.amount_cents),
      state: r.state as EntryState,
      title: String(r.title),
      description: String(r.description ?? ""),
      evidenceUrl: String(r.evidence_url ?? ""),
      occurredOn: iso(r.occurred_on).slice(0, 10),
      createdBy: String(r.created_by),
      createdAt: iso(r.created_at),
      voidedAt: r.voided_at ? iso(r.voided_at) : null,
      voidedBy: r.voided_by ? String(r.voided_by) : null,
      voidReason: r.void_reason ? String(r.void_reason) : null,
    }));
  }
  const sums = summarizeBudget(
    ledgerAvailable ? categories.map((r) => ({ direction: BUDGET_CATEGORIES[r.category].direction, state: r.state, amountCents: r.totalCents, voided: false })) : [],
    number(shop?.spent_cents),
  );
  return {
    ledgerAvailable, ledger, categories, ...sums,
    shop: {
      ordersWithActualCost: number(shop?.orders),
      redeemedPx: number(shop?.redeemed_px),
      missingActualCost: number(shop?.missing_cost),
    },
    reviewers, reviewerNetPx,
    reviewerPaidCount: reviewers.reduce((s, r) => s + r.paidReviews, 0),
    reviewerPendingCount: reviewers.reduce((s, r) => s + r.pendingReviews, 0),
    fulfillerNetPx: number(p?.fulfiller_px),
    projectPayoutPx: number(p?.project_px),
    reviewRates: rateRows[0] ? { approved: number(rateRows[0].approved_pixels), changes: number(rateRows[0].needs_changes_pixels) } : null,
  };
}

export interface NewBudgetEntry {
  direction: Direction;
  category: BudgetCategory;
  amountCents: number;
  state: EntryState;
  title: string;
  description: string;
  evidenceUrl: string;
  occurredOn: string;
  createdBy: string;
}

// Never silently write to alternate databases or duplicate the auto-recorded
// shop costs. Requires the dedicated migration to be applied by an operator.
export async function createBudgetEntry(entry: NewBudgetEntry): Promise<void> {
  await sql`
    INSERT INTO budget_entries
      (direction, category, amount_cents, state, title, description, evidence_url, occurred_on, created_by)
    VALUES (
      ${entry.direction}, ${entry.category}, ${entry.amountCents}, ${entry.state},
      ${entry.title}, ${entry.description}, ${entry.evidenceUrl},
      ${entry.occurredOn}::date, ${entry.createdBy}
    )
  `;
}

// Corrections never erase an audit trail.
export async function voidBudgetEntry(id: number, actor: string, reason: string): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    UPDATE budget_entries SET voided_at = NOW(), voided_by = ${actor}, void_reason = ${reason}
    WHERE id = ${id} AND voided_at IS NULL RETURNING id
  `;
  return rows.length === 1;
}
