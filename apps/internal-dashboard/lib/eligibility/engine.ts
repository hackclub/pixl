import { faceValueRule, type EligibilityPolicy } from "./policy";

export type EligibilityStatus = "covered" | "insufficient" | "unverified" | "review_required" | "restricted";

export type AirtableState = "none" | "present" | "submitted" | "missing" | "unavailable";
export type UnifiedState = "confirmed" | "pending" | "removed" | "disputed" | "unverifiable";

export type ShipsState =
  | "approved"
  | "approval_unconfirmed"
  | "not_found"
  | "ambiguous"
  | "identity_mismatch"
  | "no_record"
  | "unavailable";

export interface ShipsEvidence {
  state: ShipsState;
  recordId: string | null;
  matchedBy: "record_id" | "repo_slack" | null;
  hours: number | null;
  approvedAt: number | null;
  githubUsername?: string | null;
  siblings?: { count: number; hours: number };
  note: string;
}

export type VerificationLabel =
  | "verified"
  | "approval_unconfirmed"
  | "pending_submission"
  | "not_found"
  | "unavailable"
  | "needs_review";

export interface ProjectEvidence {
  projectId: number;
  userId: string;
  name: string;
  role: "owner" | "collaborator";
  approvedHours: number;
  originalHours: number | null;
  deflated: boolean;
  status: string;
  banned: boolean;
  repoKey: string | null;
  airtable: AirtableState;
  airtableRecordId: string | null;
  unified: UnifiedState;
  unifiedRef: string | null;
  disputed: boolean;
  ships?: ShipsEvidence | null;
  priorApprovedHours?: number;
  payout?: PayoutHistory | null;
}

export interface PayoutHistory {
  netPx: number;
  withheldPx: number;
  creditedHours: number;
  rows: number;
}

export interface PriorGrant {
  projectId: number;
  name: string;
  usd: number;
  deductedPx: number;
  ambiguous: boolean;
}

export interface OrderInput {
  id: number;
  userId: string;
  itemName: string;
  quantity: number;
  pricePx: number;
  status: string;
  actualCostUsd: number | null;
  flagged: boolean;
  grantFaceUsd?: number | null;
  grantProjectId?: number | null;
  duplicateGrant?: boolean;
}

export interface LedgerEntry {
  orderId: number;
  amountCents: number;
}

export interface EvidenceMeta {
  loadedAt: number;
  commitmentsKnown: boolean;
  airtableAvailable: boolean;
  unifiedAvailable: boolean;
  restrictions: string[];
  shipsAvailable?: boolean;
  shipsFetchedAt?: number | null;
  shipsError?: string | null;
}

export interface EligibilityInput {
  policy: EligibilityPolicy;
  pixelValueUsd: number;
  now: number;
  order: OrderInput;
  playerOrders: OrderInput[];
  ledger: LedgerEntry[];
  projects: ProjectEvidence[];
  priorGrants: PriorGrant[];
  meta: EvidenceMeta;
}

export type AmountBasis = "face" | "actual" | "budget";

export interface OrderAmount {
  cents: number;
  basis: AmountBasis;
  budgetCents: number;
  faceCents: number | null;
  actualCents: number | null;
  pixels: number;
}

export interface ProjectLine {
  projectId: number;
  name: string;
  role: "owner" | "collaborator";
  hours: number;
  originalHours: number | null;
  airtable: AirtableState;
  unified: UnifiedState;
  counted: "verified" | "provisional" | "excluded";
  excludedReason: string | null;
  airtableRecordId: string | null;
  unifiedRef: string | null;
  verification: VerificationLabel;
  verificationNote: string;
  ships: ShipsEvidence | null;
  expectedShipsHours: number | null;
  countedHours: number;
  highHours: number;
  discrepancy: "none" | "rounding" | "material";
  multiRecord: boolean;
  repoKey: string | null;
  fundingSource: "flat" | "payout" | "none";
  payoutHours: number | null;
  payoutCents: number | null;
  payoutGrossCents: number | null;
  payoutCapped: boolean;
  effectiveRateUsd: number | null;
}

export interface CommitmentLine {
  orderId: number;
  itemName: string;
  status: string;
  cents: number;
  source: "ledger" | "derived";
}

export interface Reason {
  code: string;
  message: string;
}

export interface EligibilityResult {
  policyVersion: string;
  status: EligibilityStatus;
  reasons: Reason[];
  rateUsd: number;
  fundingBasis: "flat_rate" | "payout_history";
  unestablishedHours: number;
  projects: ProjectLine[];
  verifiedHours: number;
  provisionalHours: number;
  verifiedFundingCents: number;
  upperBoundFundingCents: number;
  committedCents: number;
  commitments: CommitmentLine[];
  priorGrants: PriorGrant[];
  priorGrantCents: number;
  amount: OrderAmount;
  remainingCents: number;
  afterCents: number;
  provisionalRemainingCents: number;
  evidenceAgeMs: number;
  stale: boolean;
  integrations: { airtable: boolean; unified: boolean };
  ships: { available: boolean; fetchedAt: number | null; ageMs: number | null; stale: boolean; error: string | null };
  verifiedHighFundingCents: number;
  verification: VerificationLabel;
  verificationSummary: string;
}

const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const CLAIMED_STATES = new Set(["ordered", "credited", "shipped", "done"]);

export const toCents = (usd: number): number => Math.round(usd * 100);
export const fromCents = (cents: number): number => cents / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function orderAmount(order: OrderInput, policy: EligibilityPolicy, pixelValueUsd: number): OrderAmount {
  const qty = Math.max(1, Math.floor(order.quantity) || 1);
  const budgetCents = toCents(order.pricePx * pixelValueUsd);
  const rule = faceValueRule(policy, order.itemName);
  const faceCents =
    order.grantFaceUsd != null && order.grantFaceUsd > 0
      ? toCents(order.grantFaceUsd)
      : rule
        ? toCents(rule.faceValueUsd) * qty
        : null;
  const actualCents = order.actualCostUsd != null && Number.isFinite(order.actualCostUsd) ? toCents(order.actualCostUsd) : null;
  if (order.status === "cancelled") {
    return { cents: 0, basis: "budget", budgetCents, faceCents, actualCents, pixels: order.pricePx };
  }
  if (faceCents != null) return { cents: faceCents, basis: "face", budgetCents, faceCents, actualCents, pixels: order.pricePx };
  if (actualCents != null) return { cents: actualCents, basis: "actual", budgetCents, faceCents, actualCents, pixels: order.pricePx };
  return { cents: budgetCents, basis: "budget", budgetCents, faceCents, actualCents, pixels: order.pricePx };
}

const EPS = 1e-9;

function verificationOf(p: ProjectEvidence, counted: ProjectLine["counted"]): { label: VerificationLabel; note: string } {
  const sh = p.ships;
  if (counted === "verified") {
    if (sh?.state === "approved") return { label: "verified", note: "Found in Ships and approved" };
    return { label: "verified", note: "Confirmed in Unified" };
  }
  if (sh?.state === "approved" && p.disputed) {
    return { label: "needs_review", note: "Found in Ships, but the project's hours are disputed or flagged as a possible duplicate." };
  }
  if (!sh) {
    return p.unified === "unverifiable"
      ? { label: "unavailable", note: "No verification source was available." }
      : { label: "approval_unconfirmed", note: "Unified has not confirmed this project." };
  }
  switch (sh.state) {
    case "approval_unconfirmed":
      return { label: "approval_unconfirmed", note: sh.note };
    case "not_found":
      return p.airtable === "submitted"
        ? { label: "not_found", note: "Submitted to Airtable, awaiting Ships verification. Not present in the current Ships dataset (absence is not a rejection)." }
        : { label: "pending_submission", note: "Not present in Ships and not yet submitted from Airtable staging." };
    case "no_record":
      return { label: "pending_submission", note: sh.note };
    case "ambiguous":
    case "identity_mismatch":
      return { label: "needs_review", note: sh.note };
    case "unavailable":
      return { label: "unavailable", note: sh.note };
    default:
      return { label: "verified", note: sh.note };
  }
}

function fundingOf(
  p: ProjectEvidence,
  policy: EligibilityPolicy,
  pixelValueUsd: number,
): Pick<ProjectLine, "fundingSource" | "payoutHours" | "payoutCents" | "payoutGrossCents" | "payoutCapped" | "effectiveRateUsd"> {
  if (policy.fundingBasis !== "payout_history") {
    return { fundingSource: "flat", payoutHours: null, payoutCents: null, payoutGrossCents: null, payoutCapped: false, effectiveRateUsd: policy.ratePerHourUsd };
  }
  const h = p.payout;
  if (!h || h.rows <= 0 || !(h.creditedHours > 0)) {
    return { fundingSource: "none", payoutHours: null, payoutCents: null, payoutGrossCents: null, payoutCapped: false, effectiveRateUsd: null };
  }
  const gross = Math.max(0, Math.round((h.netPx + h.withheldPx) * pixelValueUsd * 100));
  const cap = Math.round(h.creditedHours * policy.maxRateUsd * 100);
  const cents = Math.min(gross, cap);
  return {
    fundingSource: "payout",
    payoutHours: h.creditedHours,
    payoutCents: cents,
    payoutGrossCents: gross,
    payoutCapped: gross > cap,
    effectiveRateUsd: Math.round((cents / 100 / h.creditedHours) * 100) / 100,
  };
}

function lineFundingCents(l: ProjectLine, hours: number, policy: EligibilityPolicy): number | null {
  if (l.fundingSource === "flat") return Math.round(hours * policy.ratePerHourUsd * 100);
  if (l.fundingSource !== "payout" || l.payoutCents == null || !l.payoutHours) return null;
  return Math.round(l.payoutCents * Math.min(1, hours / l.payoutHours));
}

function classifyProjects(projects: ProjectEvidence[], policy: EligibilityPolicy, pixelValueUsd: number): ProjectLine[] {
  const ordered = [...projects].sort(
    (a, b) => (a.role === b.role ? a.projectId - b.projectId : a.role === "owner" ? -1 : 1),
  );
  const seenProject = new Set<number>();
  const seenRepo = new Set<string>();
  const lines: ProjectLine[] = [];
  for (const p of ordered) {
    let excluded: string | null = null;
    if (seenProject.has(p.projectId)) excluded = "duplicate row for the same project";
    else if (p.status !== "approved") excluded = `project is ${p.status}`;
    else if (p.banned) excluded = "project is banned";
    else if (p.unified === "removed") excluded = "removed from Unified";
    else if (p.repoKey && seenRepo.has(p.repoKey)) excluded = "same repository already counted";
    else if (!(p.approvedHours > 0)) excluded = "no approved hours";
    seenProject.add(p.projectId);
    if (!excluded && p.repoKey) seenRepo.add(p.repoKey);
    const shipsOk = p.ships?.state === "approved" && p.ships.hours != null;
    let counted: ProjectLine["counted"] = "excluded";
    if (!excluded) counted = (shipsOk || p.unified === "confirmed") && !p.disputed ? "verified" : "provisional";
    const hours = round1(Math.max(0, p.approvedHours));
    let countedHours = hours;
    let highHours = hours;
    let expected: number | null = null;
    let discrepancy: ProjectLine["discrepancy"] = "none";
    let multiRecord = false;
    if (shipsOk && counted === "verified") {
      const prior = Math.max(0, p.priorApprovedHours ?? 0);
      expected = round1(Math.max(0, hours - prior));
      const h = p.ships!.hours!;
      countedHours = Math.min(h, expected);
      highHours = Math.max(h, expected);
      const diff = Math.abs(h - expected);
      discrepancy = diff < EPS ? "none" : diff < 1 ? "rounding" : "material";
      multiRecord = prior > 0;
    }
    const v = verificationOf(p, counted);
    const funding = fundingOf(p, policy, pixelValueUsd);
    lines.push({
      ...funding,
      projectId: p.projectId,
      name: p.name,
      role: p.role,
      hours,
      originalHours: p.originalHours,
      airtable: p.airtable,
      unified: p.unified,
      counted,
      excludedReason: excluded,
      airtableRecordId: p.airtableRecordId,
      unifiedRef: p.unifiedRef,
      verification: v.label,
      verificationNote: v.note,
      ships: p.ships ?? null,
      expectedShipsHours: expected,
      countedHours: round1(countedHours),
      highHours: round1(highHours),
      discrepancy,
      multiRecord,
      repoKey: p.repoKey,
    });
  }
  return lines;
}

const WORST: VerificationLabel[] = ["needs_review", "unavailable", "not_found", "approval_unconfirmed", "pending_submission"];

function summarize(lines: ProjectLine[], verifiedHours: number): { label: VerificationLabel; text: string } {
  const live = lines.filter((l) => l.counted !== "excluded");
  const bad = WORST.find((w) => live.some((l) => l.verification === w));
  if (bad === "needs_review") {
    return { label: bad, text: live.find((l) => l.verification === bad)!.verificationNote };
  }
  if (verifiedHours > 0 && !bad) return { label: "verified", text: `Found in Ships · ${verifiedHours.toFixed(1)}h verified` };
  if (bad) {
    const note = live.find((l) => l.verification === bad)!.verificationNote;
    if (verifiedHours > 0) return { label: bad, text: `${verifiedHours.toFixed(1)}h verified; ${note}` };
    return { label: bad, text: note };
  }
  return { label: "pending_submission", text: "No project with approved hours is mapped to this player." };
}

function commitmentsFor(input: EligibilityInput): CommitmentLine[] {
  const ledger = new Map(input.ledger.map((l) => [l.orderId, l.amountCents]));
  const out: CommitmentLine[] = [];
  const seen = new Set<number>();
  for (const o of input.playerOrders) {
    if (o.id === input.order.id || seen.has(o.id)) continue;
    seen.add(o.id);
    if (!CLAIMED_STATES.has(o.status)) continue;
    const ledgerCents = ledger.get(o.id);
    if (ledgerCents != null) {
      out.push({ orderId: o.id, itemName: o.itemName, status: o.status, cents: ledgerCents, source: "ledger" });
    } else {
      const a = orderAmount(o, input.policy, input.pixelValueUsd);
      out.push({ orderId: o.id, itemName: o.itemName, status: o.status, cents: a.cents, source: "derived" });
    }
  }
  return out;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const { policy, order, meta } = input;
  const amount = orderAmount(order, policy, input.pixelValueUsd);
  const lines = classifyProjects(input.projects, policy, input.pixelValueUsd);
  const verifiedLines = lines.filter((l) => l.counted === "verified");
  const verifiedHours = round1(verifiedLines.reduce((s, l) => s + l.countedHours, 0));
  const verifiedHighHours = round1(verifiedLines.reduce((s, l) => s + l.highHours, 0));
  const provisionalHours = round1(
    lines.filter((l) => l.counted === "provisional").reduce((s, l) => s + l.hours, 0) +
      verifiedLines.filter((l) => l.multiRecord).reduce((s, l) => s + Math.max(0, l.hours - (l.expectedShipsHours ?? l.hours)), 0),
  );
  const payoutBasis = policy.fundingBasis === "payout_history";
  let verifiedFundingCents = 0;
  let verifiedHighFundingCents = 0;
  let upperBoundFundingCents = 0;
  const unestablished: ProjectLine[] = [];
  if (!payoutBasis) {
    const fund = (hours: number): number => Math.round(hours * policy.ratePerHourUsd * 100);
    verifiedFundingCents = fund(verifiedHours);
    verifiedHighFundingCents = fund(verifiedHighHours);
    upperBoundFundingCents = fund(round1(verifiedHighHours + provisionalHours));
  } else {
    for (const l of verifiedLines) {
      const c = lineFundingCents(l, l.countedHours, policy);
      if (c == null) unestablished.push(l);
      else {
        verifiedFundingCents += c;
        verifiedHighFundingCents += lineFundingCents(l, l.highHours, policy) ?? 0;
      }
    }
    for (const l of lines) {
      if (l.counted === "excluded") continue;
      const h = Math.max(l.hours, l.highHours);
      upperBoundFundingCents += lineFundingCents(l, h, policy) ?? Math.round(h * policy.maxRateUsd * 100);
    }
  }
  const unestablishedHours = round1(unestablished.reduce((s, l) => s + l.countedHours, 0));

  const commitments = commitmentsFor(input);
  const priorGrantCents = input.priorGrants.reduce((s, g) => s + toCents(g.usd), 0);
  const committedCents = commitments.reduce((s, c) => s + c.cents, 0) + priorGrantCents;
  const remainingCents = verifiedFundingCents - committedCents;
  const afterCents = remainingCents - amount.cents;
  const provisionalRemainingCents = upperBoundFundingCents - committedCents;
  const remainingHighCents = verifiedHighFundingCents - committedCents;

  const evidenceAgeMs = Math.max(0, input.now - meta.loadedAt);
  const dependsOnShips = verifiedLines.some((l) => l.ships?.state === "approved");
  const shipsAgeMs = meta.shipsFetchedAt == null ? null : Math.max(0, input.now - meta.shipsFetchedAt);
  const shipsStale = dependsOnShips && (shipsAgeMs == null || shipsAgeMs > policy.shipsMaxAgeMs);
  const stale = evidenceAgeMs > policy.evidenceMaxAgeMs || shipsStale;

  const reasons: Reason[] = [];
  const add = (code: string, message: string) => reasons.push({ code, message });

  for (const r of meta.restrictions) add("restricted", r);
  const restricted = meta.restrictions.length > 0;

  const reviewReasons: Reason[] = [];
  if (lines.some((l) => l.counted !== "excluded" && input.projects.find((p) => p.projectId === l.projectId)?.disputed)) {
    reviewReasons.push({ code: "disputed_hours", message: "A project's hours are disputed or flagged as a possible duplicate YSWS submission." });
  }
  if (lines.some((l) => l.airtable === "missing")) {
    reviewReasons.push({ code: "missing_airtable_record", message: "A project points at an Airtable staging record that no longer exists." });
  }
  if (lines.some((l) => l.excludedReason === "same repository already counted")) {
    reviewReasons.push({ code: "duplicate_submission", message: "Two projects share a repository; hours were counted once." });
  }
  if (input.projects.length === 0) {
    reviewReasons.push({ code: "no_projects", message: "No project mapped to this player; hours cannot be attributed." });
  }
  const liveLines = lines.filter((l) => l.counted !== "excluded");
  if (liveLines.some((l) => l.ships?.state === "ambiguous" || l.ships?.state === "identity_mismatch")) {
    reviewReasons.push({
      code: "ships_identity",
      message: liveLines.find((l) => l.ships?.state === "ambiguous" || l.ships?.state === "identity_mismatch")!.ships!.note,
    });
  }
  if (
    order.status !== "cancelled" &&
    meta.commitmentsKnown &&
    amount.cents > remainingCents &&
    amount.cents <= remainingHighCents
  ) {
    reviewReasons.push({
      code: "hours_discrepancy",
      message: `Ships and Airtable hours differ by a margin that decides this order (${fmt(remainingCents)} vs ${fmt(remainingHighCents)} available).`,
    });
  }
  if (order.duplicateGrant && order.status !== "cancelled") {
    reviewReasons.push({ code: "duplicate_funding_order", message: "Another order already exists for the same project funding grant." });
  }
  if (input.priorGrants.some((g) => g.ambiguous)) {
    reviewReasons.push({ code: "grant_link_ambiguous", message: "An approved funding grant could not be matched to its order; it may be counted twice." });
  }
  if (order.flagged) {
    reviewReasons.push({ code: "flagged_over_budget", message: "Order is flagged over budget." });
  }
  if (amount.basis !== "face" && amount.actualCents != null && amount.actualCents > amount.budgetCents + toCents(policy.overBudgetToleranceUsd)) {
    reviewReasons.push({ code: "above_budget", message: "Recorded supplier cost exceeds the shop budget." });
  }
  if (amount.cents === 0 && order.status !== "cancelled") {
    reviewReasons.push({ code: "zero_value", message: "Order has no priced value to count." });
  }
  for (const r of reviewReasons) reasons.push(r);
  if (amount.basis === "face" && order.status !== "cancelled") {
    const other = amount.actualCents ?? amount.budgetCents;
    if (Math.abs(other - amount.cents) > toCents(policy.overBudgetToleranceUsd)) {
      add(
        "amount_discrepancy",
        `Counted at grant face value ${fmt(amount.cents)}; ${amount.actualCents != null ? "recorded supplier cost" : "shop budget"} is ${fmt(other)}.`,
      );
    }
  }

  let status: EligibilityStatus;
  if (restricted) status = "restricted";
  else if (reviewReasons.length > 0) status = "review_required";
  else if (!meta.commitmentsKnown) {
    status = "unverified";
    add("commitments_unknown", "Previous commitments could not be loaded.");
  } else if (amount.cents <= remainingCents && !stale && verifiedFundingCents > 0) {
    status = "covered";
  } else if (provisionalRemainingCents < amount.cents) {
    status = "insufficient";
    add("insufficient_upper_bound", "Even counting every unverified approved hour, funding is below the order.");
  } else if (provisionalHours > 0 || unestablished.length > 0 || stale || verifiedFundingCents === 0) {
    status = "unverified";
    if (provisionalHours > 0) add("unverified_hours", "Some hours are not confirmed in Unified.");
    for (const l of unestablished) add("payout_unestablished", `${l.name}: no pixel payout history was found, so its funding cannot be established.`);
    if (shipsStale) add("ships_stale", "The Ships snapshot is older than the policy freshness window.");
    else if (stale) add("stale_evidence", "Evidence is older than the policy freshness window.");
    if (verifiedFundingCents === 0 && provisionalHours === 0) add("no_hours", "No eligible hours found.");
  } else {
    status = "insufficient";
    add("insufficient_verified", "Verified funding is below the order after previous commitments.");
  }

  if (!meta.unifiedAvailable) add("unified_unavailable", "Ships could not be read, so hours cannot be confirmed.");
  if (meta.shipsError && dependsOnShips) add("ships_refresh_failing", `Last Ships refresh failed (${meta.shipsError}); using the snapshot from ${shipsAgeMs == null ? "an unknown time" : `${Math.round(shipsAgeMs / 60000)}m ago`}.`);
  for (const l of verifiedLines) {
    if (l.discrepancy !== "none" && l.ships?.hours != null) {
      add(
        l.discrepancy === "rounding" ? "hours_rounding" : "hours_mismatch",
        `${l.name}: Ships ${l.ships.hours}h vs Airtable ${l.expectedShipsHours?.toFixed(1)}h; counted ${l.countedHours.toFixed(1)}h (the lower figure).`,
      );
    }
    if (l.multiRecord) {
      const sib = l.ships?.siblings;
      add(
        "multi_record_hours",
        `${l.name}: earlier-ship hours sit in another Unified record and stay unverified here.${
          sib && sib.count > 0 ? ` Ships lists ${sib.count} other PIXL record${sib.count === 1 ? "" : "s"} for this repository (${sib.hours}h), not counted automatically.` : ""
        }`,
      );
    }
  }
  for (const l of lines) {
    if (l.fundingSource === "payout" && l.payoutCapped) {
      add("payout_capped", `${l.name}: the payout exceeded the ${policy.maxRateUsd.toFixed(2)} per hour maximum, so funding is capped there; the excess is treated as a bonus.`);
    }
  }
  const summary = summarize(lines, verifiedHours);
  if (!meta.airtableAvailable) add("airtable_unavailable", "Airtable could not be read; staging status unknown.");

  return {
    policyVersion: policy.version,
    status,
    reasons,
    rateUsd: payoutBasis ? (verifiedHours > 0 ? Math.round((verifiedFundingCents / verifiedHours)) / 100 : 0) : policy.ratePerHourUsd,
    fundingBasis: policy.fundingBasis,
    unestablishedHours,
    projects: lines,
    verifiedHours,
    provisionalHours,
    verifiedFundingCents,
    upperBoundFundingCents,
    committedCents,
    commitments,
    priorGrants: input.priorGrants,
    priorGrantCents,
    amount,
    remainingCents,
    afterCents,
    provisionalRemainingCents,
    evidenceAgeMs,
    stale,
    integrations: { airtable: meta.airtableAvailable, unified: meta.unifiedAvailable },
    ships: {
      available: meta.shipsAvailable ?? false,
      fetchedAt: meta.shipsFetchedAt ?? null,
      ageMs: shipsAgeMs,
      stale: shipsStale,
      error: meta.shipsError ?? null,
    },
    verifiedHighFundingCents,
    verification: summary.label,
    verificationSummary: summary.text,
  };
}
