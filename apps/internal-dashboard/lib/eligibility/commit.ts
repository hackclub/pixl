import { db as realDb } from "../pgCompat";
import { config } from "@/app/_generated/config";
import type { ShipsProvider, ShipsView } from "./ships";
import { toOrderInput, loadPlayerEvidence, evaluateFromEvidence, withGrantLink, type SqlLike, type UnifiedVerifier } from "./evidence";
import { orderAmount, type EligibilityResult } from "./engine";
import { currentPolicy, type EligibilityPolicy } from "./policy";

export type ClaimOutcome =
  | { kind: "claimed"; code: string; result: EligibilityResult | null; degraded: boolean }
  | { kind: "unledgered"; reason: "ledger_not_installed" }
  | { kind: "refused"; code: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  not_found: "Order not found.",
  not_pending: "Order is no longer waiting to be claimed.",
  not_covered: "Funding for this player is not verified as covering this order.",
  insufficient: "Another claim just used this player's remaining funding.",
  evidence_unavailable: "Eligibility evidence could not be loaded.",
};

export function evidenceSnapshot(r: EligibilityResult): Record<string, unknown> {
  return {
    status: r.status,
    reasons: r.reasons.map((x) => x.code),
    rateUsd: r.rateUsd,
    verifiedHours: r.verifiedHours,
    provisionalHours: r.provisionalHours,
    projectVerifiedFundingCents: r.projectVerifiedFundingCents,
    unverifiedProjectFundingCents: r.unverifiedProjectFundingCents,
    reviewerEarnings: {
      state: r.reviewerEarnings.state,
      creditedPixels: r.reviewerEarnings.creditedPixels,
      correctionPixels: r.reviewerEarnings.correctionPixels,
      netPixels: r.reviewerEarnings.netPixels,
      verifiedPixels: r.reviewerEarnings.verifiedPixels,
      fundingCents: r.reviewerEarnings.fundingCents,
      rows: r.reviewerEarnings.rows,
    },
    verifiedFundingCents: r.verifiedFundingCents,
    upperBoundFundingCents: r.upperBoundFundingCents,
    committedCents: r.committedCents,
    priorGrantCents: r.priorGrantCents,
    amountBasis: r.amount.basis,
    evidenceAgeMs: r.evidenceAgeMs,
    integrations: r.integrations,
    projects: r.projects.map((p) => ({
      id: p.projectId,
      hours: p.hours,
      counted: p.counted,
      unified: p.unified,
      airtable: p.airtable,
    })),
    commitments: r.commitments.map((c) => ({ orderId: c.orderId, cents: c.cents, source: c.source })),
  };
}

export function claimRpcArgs(
  r: EligibilityResult,
  p: { orderId: number; by: string; bySlack: string; enforce: boolean },
): Record<string, unknown> {
  return {
    p_order_id: p.orderId,
    p_by: p.by,
    p_by_slack: p.bySlack,
    p_amount_cents: r.amount.cents,
    p_basis: r.amount.basis,
    p_verified_funding_cents: r.verifiedFundingCents,
    p_other_committed_cents:
      r.commitments.filter((c) => c.source === "derived").reduce((s, c) => s + c.cents, 0) + r.priorGrantCents,
    p_enforce: p.enforce,
    p_verdict: r.status,
    p_policy_version: r.policyVersion,
    p_evidence: evidenceSnapshot(r),
  };
}

function degradedRpcArgs(
  row: Parameters<typeof toOrderInput>[0],
  policy: EligibilityPolicy,
  p: { orderId: number; by: string; bySlack: string },
): Record<string, unknown> {
  const amount = orderAmount(toOrderInput(row), policy, config.economy.pixelValueUsd);
  return {
    p_order_id: p.orderId,
    p_by: p.by,
    p_by_slack: p.bySlack,
    p_amount_cents: amount.cents,
    p_basis: amount.basis,
    p_verified_funding_cents: 0,
    p_other_committed_cents: 0,
    p_enforce: false,
    p_verdict: "unverified",
    p_policy_version: policy.version,
    p_evidence: { degraded: "evidence_unavailable" },
  };
}

const LEDGER_MISSING = new Set(["42883", "42P01"]);

export async function claimOrderWithFunding(
  p: { orderId: number; by: string; bySlack: string },
  opts: { policy?: EligibilityPolicy; verifier?: UnifiedVerifier; db?: typeof realDb; sql?: SqlLike; ships?: ShipsProvider | ShipsView } = {},
): Promise<ClaimOutcome> {
  const policy = opts.policy ?? currentPolicy();
  const db = opts.db ?? realDb;
  const { data: row, error: rowError } = await db.from("shop_orders").select("*").eq("id", p.orderId).maybeSingle();
  if (rowError) throw new Error(rowError.message);
  if (!row) return { kind: "refused", code: "not_found", message: REFUSAL_MESSAGES.not_found! };

  let result: EligibilityResult | null = null;
  try {
    const ev = await loadPlayerEvidence([row.user_id as string], { liveAirtable: true, verifier: opts.verifier, sql: opts.sql, ships: opts.ships });
    const player = ev.get(row.user_id as string);
    if (player) result = evaluateFromEvidence(player, toOrderInput(row as Parameters<typeof toOrderInput>[0]), policy);
  } catch (e) {
    console.error("claimOrderWithFunding evaluate", (e as Error).message);
  }

  if (!result && policy.enforceOnClaim) {
    return { kind: "refused", code: "evidence_unavailable", message: REFUSAL_MESSAGES.evidence_unavailable! };
  }

  const args = result
    ? claimRpcArgs(result, { ...p, enforce: policy.enforceOnClaim })
    : degradedRpcArgs(row as Parameters<typeof toOrderInput>[0], policy, p);
  const { data, error } = await db.rpc<{ ok: boolean; code: string }>("claim_shop_order_with_commitment", args);
  if (error) {
    if (LEDGER_MISSING.has(error.code ?? "") && policy.allowUnledgeredClaim) {
      console.error("claimOrderWithFunding: ledger not installed, claim will not be recorded", error.message);
      return { kind: "unledgered", reason: "ledger_not_installed" };
    }
    if (LEDGER_MISSING.has(error.code ?? "")) {
      throw new Error("Funding ledger is not installed (migration 0229). Claim refused.");
    }
    throw new Error(error.message);
  }
  if (!data?.ok) {
    const code = data?.code ?? "unknown";
    return { kind: "refused", code, message: REFUSAL_MESSAGES[code] ?? "Claim was refused." };
  }
  return { kind: "claimed", code: data.code, result, degraded: !result };
}

export type RefreshOutcome = "refreshed" | "no_ledger_row" | "ledger_not_installed" | "failed";

export async function refreshCommitmentAmount(
  orderId: number,
  opts: { db?: typeof realDb; policy?: EligibilityPolicy; sql?: SqlLike; ships?: ShipsProvider | ShipsView } = {},
): Promise<RefreshOutcome> {
  const db = opts.db ?? realDb;
  const policy = opts.policy ?? currentPolicy();
  try {
    const { data: row, error: rowError } = await db.from("shop_orders").select("*").eq("id", orderId).maybeSingle();
    if (rowError || !row) return "failed";
    const base = toOrderInput(row as Parameters<typeof toOrderInput>[0]);
    const ev = await loadPlayerEvidence([base.userId], { liveAirtable: false, sql: opts.sql, ships: opts.ships });
    const player = ev.get(base.userId);
    const amount = orderAmount(player ? withGrantLink(player, base) : base, policy, config.economy.pixelValueUsd);
    const { data, error } = await db.rpc<boolean>("refresh_fulfillment_commitment", {
      p_order_id: orderId,
      p_amount_cents: amount.cents,
      p_basis: amount.basis,
    });
    if (error) {
      if (LEDGER_MISSING.has(error.code ?? "")) return "ledger_not_installed";
      console.error("refreshCommitmentAmount", error.message);
      return "failed";
    }
    return data ? "refreshed" : "no_ledger_row";
  } catch (e) {
    console.error("refreshCommitmentAmount", (e as Error).message);
    return "failed";
  }
}
