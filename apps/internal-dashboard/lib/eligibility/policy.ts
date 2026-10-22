export interface ItemValueRule {
  match: RegExp;
  basis: "face";
  faceValueUsd: number;
}

export interface EligibilityPolicy {
  version: string;
  ratePerHourUsd: number;
  evidenceMaxAgeMs: number;
  shipsMaxAgeMs: number;
  overBudgetToleranceUsd: number;
  enforceOnClaim: boolean;
  allowUnledgeredClaim: boolean;
  fundingBasis: "flat_rate" | "payout_history";
  maxRateUsd: number;
  itemValueRules: ItemValueRule[];
}

export const POLICIES: Record<string, EligibilityPolicy> = {
  "2026-10-22.1": {
    version: "2026-10-22.1",
    ratePerHourUsd: 4,
    evidenceMaxAgeMs: 6 * 60 * 60 * 1000,
    shipsMaxAgeMs: 30 * 60 * 1000,
    overBudgetToleranceUsd: 0.01,
    enforceOnClaim: false,
    allowUnledgeredClaim: false,
    fundingBasis: "flat_rate",
    maxRateUsd: 6,
    itemValueRules: [{ match: /^hardware grant$/i, basis: "face", faceValueUsd: 10 }],
  },
  "2026-10-22.2": {
    version: "2026-10-22.2",
    ratePerHourUsd: 4,
    evidenceMaxAgeMs: 6 * 60 * 60 * 1000,
    shipsMaxAgeMs: 30 * 60 * 1000,
    overBudgetToleranceUsd: 0.01,
    enforceOnClaim: false,
    allowUnledgeredClaim: false,
    fundingBasis: "flat_rate",
    maxRateUsd: 6,
    itemValueRules: [{ match: /^hardware grant$/i, basis: "face", faceValueUsd: 10 }],
  },
  "2026-10-22.3": {
    version: "2026-10-22.3",
    ratePerHourUsd: 4,
    evidenceMaxAgeMs: 6 * 60 * 60 * 1000,
    shipsMaxAgeMs: 30 * 60 * 1000,
    overBudgetToleranceUsd: 0.01,
    enforceOnClaim: false,
    allowUnledgeredClaim: false,
    fundingBasis: "payout_history",
    maxRateUsd: 6,
    itemValueRules: [{ match: /^hardware grant$/i, basis: "face", faceValueUsd: 10 }],
  },
};

export const CURRENT_POLICY_VERSION = "2026-10-22.3";

export function currentPolicy(): EligibilityPolicy {
  return POLICIES[CURRENT_POLICY_VERSION]!;
}

export function policyByVersion(version: string): EligibilityPolicy | null {
  return POLICIES[version] ?? null;
}

export function faceValueRule(policy: EligibilityPolicy, itemName: string): ItemValueRule | null {
  const name = itemName.trim();
  return policy.itemValueRules.find((r) => r.match.test(name)) ?? null;
}

export const FUNDING_ORDER_PREFIX = "Hardware funding grant , ";
