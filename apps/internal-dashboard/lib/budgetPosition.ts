import { sql } from "./pgCompat";
import { nominalValueCents } from "./budgetMath";

export interface BudgetPosition {
  walletsPx: number;
  negativeWalletsPx: number;
  pendingOrdersPx: number;
  orderedPx: number;
  pendingOrders: number;
  orderedOrders: number;
  fulfilledPx: number;
  fulfilledOrders: number;
  heldTrialPx: number;
  pendingReviewPx: number;
  uncreditedReviewPx: number;
  walletDriftPx: number;
  walletDriftAccounts: number;
  reviewerNames: Record<string, string>;
  readAt: string;
}

export function reserveLines(p: BudgetPosition, pixelValueUsd: number) {
  return [
    { label: "Wallet balances", pixels: p.walletsPx },
    { label: "Pending orders", pixels: p.pendingOrdersPx },
    { label: "Ordered prizes", pixels: p.orderedPx },
    { label: "Unclaimed Trial rewards", pixels: p.heldTrialPx },
    { label: "Pending review rewards", pixels: p.pendingReviewPx },
    { label: "Uncredited review rewards", pixels: p.uncreditedReviewPx },
  ].map((row) => ({ ...row, cents: nominalValueCents(row.pixels, pixelValueUsd) }));
}

export async function getBudgetPosition(): Promise<BudgetPosition> {
  const rows = await sql`SELECT now() AS read_at,
    (SELECT coalesce(sum(greatest(pixels, 0)), 0) FROM users) AS wallets_px,
    (SELECT coalesce(sum(least(pixels, 0)), 0) FROM users) AS negative_px,
    (SELECT coalesce(sum(price), 0) FROM shop_orders WHERE status = 'pending') AS pending_px,
    (SELECT coalesce(sum(price), 0) FROM shop_orders WHERE status = 'ordered') AS ordered_px,
    (SELECT count(*) FROM shop_orders WHERE status = 'pending') AS pending_orders,
    (SELECT count(*) FROM shop_orders WHERE status = 'ordered') AS ordered_orders,
    (SELECT coalesce(sum(price), 0) FROM shop_orders WHERE status IN ('credited', 'shipped', 'done')) AS fulfilled_px,
    (SELECT count(*) FROM shop_orders WHERE status IN ('credited', 'shipped', 'done')) AS fulfilled_orders,
    (SELECT coalesce(sum(greatest(trial_held_px, 0)), 0) FROM projects
      WHERE status = 'approved' AND trial_reward_choice = 'pending') AS held_px,
    (SELECT coalesce(sum(full_pixels), 0) FROM review_payouts WHERE status = 'pending') AS pending_review_px,
    (SELECT coalesce(sum(paid_pixels), 0) FROM review_payouts WHERE status = 'paid' AND NOT credited) AS uncredited_review_px,
    (SELECT coalesce(sum(u.pixels - coalesce(t.amount, 0)), 0) FROM users u
      LEFT JOIN (SELECT user_id, sum(amount) amount FROM pixel_transactions GROUP BY user_id) t ON t.user_id = u.id) AS drift_px,
    (SELECT count(*) FROM users u LEFT JOIN
      (SELECT user_id, sum(amount) amount FROM pixel_transactions GROUP BY user_id) t ON t.user_id = u.id
      WHERE u.pixels <> coalesce(t.amount, 0)) AS drift_accounts,
    (SELECT coalesce(jsonb_object_agg(reviewer_slack_id, name), '{}'::jsonb) FROM
      (SELECT reviewer_slack_id, max(reviewer) AS name FROM review_payouts
       WHERE reviewer_slack_id IS NOT NULL AND reviewer_slack_id <> '' GROUP BY reviewer_slack_id) r) AS reviewer_names`;
  const r = rows[0];
  return {
    walletsPx: Number(r.wallets_px), negativeWalletsPx: Number(r.negative_px),
    pendingOrdersPx: Number(r.pending_px), orderedPx: Number(r.ordered_px),
    pendingOrders: Number(r.pending_orders), orderedOrders: Number(r.ordered_orders),
    fulfilledPx: Number(r.fulfilled_px), fulfilledOrders: Number(r.fulfilled_orders),
    heldTrialPx: Number(r.held_px), pendingReviewPx: Number(r.pending_review_px),
    uncreditedReviewPx: Number(r.uncredited_review_px), walletDriftPx: Number(r.drift_px),
    walletDriftAccounts: Number(r.drift_accounts), reviewerNames: r.reviewer_names,
    readAt: new Date(r.read_at).toISOString(),
  };
}
