import { sql } from "@/lib/pgCompat";
import { combineReviewerTotals, costCoverage, type ReviewerBudgetRow } from "./budgetMath";

export type { ReviewerBudgetRow } from "./budgetMath";

export interface BudgetMonth {
  month: string;
  shopSpentCents: number;
  redeemedPx: number;
  orders: number;
}

export interface BudgetData {
  // Cash costs below come from existing fulfilled shop orders. This report
  // deliberately has no manual accounting writes, migrations or income ledger.
  shopSpentCents: number;
  shop: {
    ordersWithActualCost: number;
    redeemedPx: number;
    processedOrders: number;
    processedWithActualCost: number;
    missingActualCost: number;
    coveragePercent: number | null;
    openOrderCount: number;
    openOrderPx: number;
  };
  recentMonths: BudgetMonth[];
  reviewers: ReviewerBudgetRow[];
  reviewerPaidCount: number;
  reviewerPendingCount: number;
  reviewerNetPx: number;
  fulfillerNetPx: number;
  projectPayoutPx: number;
  operationAdjustmentPx: number;
  reviewRates: { approved: number; changes: number } | null;
}

const number = (v: unknown) => Number(v ?? 0) || 0;

// All reads use tables that PIXL already has. The expensive totals are
// aggregated in Postgres, never loaded as individual transaction arrays.
export async function getBudgetData(): Promise<BudgetData> {
  const [shopRows, pixelRows, payoutRows, walletRows, rateRows, monthlyRows] = await Promise.all([
    sql<{
      spent_cents: string;
      orders_with_cost: string;
      redeemed_px: string;
      processed_orders: string;
      processed_with_cost: string;
      missing_cost: string;
      open_orders: string;
      open_px: string;
    }[]>`SELECT
      COALESCE(SUM(ROUND(actual_cost_usd * 100)::bigint)
        FILTER (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL), 0)::text AS spent_cents,
      COUNT(*) FILTER (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL)::text AS orders_with_cost,
      COALESCE(SUM(price)
        FILTER (WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL), 0)::text AS redeemed_px,
      COUNT(*) FILTER (WHERE status IN ('credited','shipped','done'))::text AS processed_orders,
      COUNT(*) FILTER (WHERE status IN ('credited','shipped','done') AND actual_cost_usd IS NOT NULL)::text AS processed_with_cost,
      COUNT(*) FILTER (WHERE status IN ('credited','shipped','done') AND actual_cost_usd IS NULL)::text AS missing_cost,
      COUNT(*) FILTER (WHERE status IN ('pending','ordered'))::text AS open_orders,
      COALESCE(SUM(price) FILTER (WHERE status IN ('pending','ordered')), 0)::text AS open_px
    FROM shop_orders`,
    sql<{ project_px: string; operation_px: string; fulfiller_px: string }[]>`SELECT
      COALESCE(SUM(amount) FILTER (WHERE reason IN ('project_approved','review_reverted')), 0)::text AS project_px,
      COALESCE(SUM(amount) FILTER (WHERE reason IN ('operation_blackout','operation_blackout_reverted')), 0)::text AS operation_px,
      COALESCE(SUM(amount) FILTER (WHERE reason = 'fulfillment_payout'), 0)::text AS fulfiller_px
    FROM pixel_transactions`,
    sql<{ slack_id: string; paid_reviews: string; pending_reviews: string; paid_px: string; credited_px: string }[]>`SELECT
      reviewer_slack_id AS slack_id,
      COUNT(*) FILTER (WHERE status = 'paid')::text AS paid_reviews,
      COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_reviews,
      COALESCE(SUM(paid_pixels) FILTER (WHERE status = 'paid'), 0)::text AS paid_px,
      COALESCE(SUM(paid_pixels) FILTER (WHERE status = 'paid' AND credited = TRUE), 0)::text AS credited_px
    FROM review_payouts
    GROUP BY reviewer_slack_id`,
    sql<{ slack_id: string; net_px: string }[]>`SELECT
      u.slack_id,
      COALESCE(SUM(t.amount), 0)::text AS net_px
    FROM pixel_transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.reason IN ('review_payout','review_payout_backfill','review_payout_voided','review_payout_cut')
      AND u.slack_id IS NOT NULL AND u.slack_id <> ''
    GROUP BY u.slack_id`,
    sql<{ approved_pixels: string; needs_changes_pixels: string }[]>`SELECT
      approved_pixels, needs_changes_pixels
    FROM review_payout_settings
    ORDER BY updated_at DESC LIMIT 1`,
    sql<{ month: string; spent_cents: string; redeemed_px: string; orders: string }[]>`SELECT
      to_char(date_trunc('month', COALESCE(credited_at, created_at)), 'YYYY-MM') AS month,
      COALESCE(SUM(ROUND(actual_cost_usd * 100)::bigint), 0)::text AS spent_cents,
      COALESCE(SUM(price), 0)::text AS redeemed_px,
      COUNT(*)::text AS orders
    FROM shop_orders
    WHERE status <> 'cancelled' AND actual_cost_usd IS NOT NULL
    GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
  ]);

  const shopRow = shopRows[0];
  const processedOrders = number(shopRow?.processed_orders);
  const processedWithActualCost = number(shopRow?.processed_with_cost);
  const reviewers = combineReviewerTotals(
    payoutRows.map((r) => ({
      slackId: r.slack_id,
      paidReviews: number(r.paid_reviews),
      pendingReviews: number(r.pending_reviews),
      recordedPaidPx: number(r.paid_px),
      creditedPx: number(r.credited_px),
    })),
    walletRows.map((r) => ({ slackId: r.slack_id, netWalletPx: number(r.net_px) })),
  );
  return {
    shopSpentCents: number(shopRow?.spent_cents),
    shop: {
      ordersWithActualCost: number(shopRow?.orders_with_cost),
      redeemedPx: number(shopRow?.redeemed_px),
      processedOrders,
      processedWithActualCost,
      missingActualCost: number(shopRow?.missing_cost),
      coveragePercent: costCoverage(processedOrders, processedWithActualCost),
      openOrderCount: number(shopRow?.open_orders),
      openOrderPx: number(shopRow?.open_px),
    },
    recentMonths: monthlyRows.map((r) => ({
      month: r.month,
      shopSpentCents: number(r.spent_cents),
      redeemedPx: number(r.redeemed_px),
      orders: number(r.orders),
    })),
    reviewers,
    reviewerPaidCount: reviewers.reduce((sum, r) => sum + r.paidReviews, 0),
    reviewerPendingCount: reviewers.reduce((sum, r) => sum + r.pendingReviews, 0),
    reviewerNetPx: reviewers.reduce((sum, r) => sum + r.netWalletPx, 0),
    fulfillerNetPx: number(pixelRows[0]?.fulfiller_px),
    projectPayoutPx: number(pixelRows[0]?.project_px),
    operationAdjustmentPx: number(pixelRows[0]?.operation_px),
    reviewRates: rateRows[0]
      ? { approved: number(rateRows[0].approved_pixels), changes: number(rateRows[0].needs_changes_pixels) }
      : null,
  };
}