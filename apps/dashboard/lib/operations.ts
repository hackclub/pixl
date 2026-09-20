import { db } from "@/lib/db";
import { config } from "@/app/_generated/config";

export const BLACKOUT_SLUG = "operation-blackout";

// How rateUsd is applied on top of a contributor's own normal rate.
// "additive" (Blackout's real config) means everyone gets the same flat
// bonus - rateUsd IS the bonus (1 = +$1/hr), never a minimum. "floor" means
// nobody drops below rateUsd regardless of how high their own rate already
// is; kept only so a future operation can still use that shape if it's ever
// the right one. See apps/server/src/operations/domain.ts's RateMode.
export type RateMode = "floor" | "additive";

export type OperationStatus = "upcoming" | "active" | "ended" | "paused";
export type EntryStatus =
  | "entered"
  | "shipped"
  | "eligible"
  | "ineligible"
  | "approved"
  | "needs_changes";

export const ENTRY_STATUSES: EntryStatus[] = [
  "entered",
  "shipped",
  "eligible",
  "needs_changes",
  "approved",
  "ineligible",
];

export interface OperationRow {
  id: number;
  slug: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: OperationStatus;
  effectiveStatus: OperationStatus;
  rateUsd: number;
  rateMode: RateMode;
  gracePeriodHours: number;
}

export interface BlackoutContributor {
  userId: string;
  name: string;
  role: "owner" | "collaborator";
  hackatimeBaseSeconds: number;
  journalBaseSeconds: number;
  fixTrackedSeconds: number;
  eligibleTrackedSeconds: number;
  evidenceOk: boolean;
  evidenceAt: string | null;
  approvedHours: number | null;
  paidHours: number;
  normalUsdRate: number | null;
  effectiveUsdRate: number | null;
  grossPx: number;
  upliftPx: number;
  settled: boolean;
  settleNote: string;
}

export interface BlackoutEntry {
  id: number;
  projectId: number;
  status: EntryStatus;
  joinedAt: string;
  windowStart: string;
  firstQualifiedShipAt: string | null;
  latestShipAt: string | null;
  reshipCount: number;
  rateUsdSnapshot: number;
  rateModeSnapshot: RateMode;
  gracePeriodHoursSnapshot: number;
  decision: "eligible" | "ineligible" | null;
  decisionNote: string;
  decidedBy: string;
  decisionStage: string;
  changesRequestedAt: string | null;
  graceDeadline: string | null;
  fixWindowEnd: string | null;
  systemReason: string;
  contributors: BlackoutContributor[];
  operation: OperationRow;
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function effectiveStatusOf(
  status: OperationStatus,
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): OperationStatus {
  const t = now.getTime();
  if (status === "ended" || t >= new Date(endsAt).getTime()) return "ended";
  if (status === "paused") return "paused";
  if (t < new Date(startsAt).getTime()) return "upcoming";
  return "active";
}

function toOperation(r: Record<string, unknown>): OperationRow {
  const status = r.status as OperationStatus;
  const startsAt = iso(r.starts_at)!;
  const endsAt = iso(r.ends_at)!;
  return {
    id: num(r.id),
    slug: String(r.slug),
    name: String(r.name),
    startsAt,
    endsAt,
    status,
    effectiveStatus: effectiveStatusOf(status, startsAt, endsAt),
    rateUsd: num(r.rate_usd),
    rateMode: (r.rate_mode as RateMode) ?? "additive",
    gracePeriodHours: num(r.grace_period_hours),
  };
}

export async function getOperation(slug: string): Promise<OperationRow | null> {
  const { data } = await db.from("operations").select("*").eq("slug", slug).maybeSingle();
  return data ? toOperation(data as Record<string, unknown>) : null;
}

export async function listOperations(): Promise<OperationRow[]> {
  const { data } = await db.from("operations").select("*").order("starts_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map(toOperation);
}

export interface OperationStats {
  entries: {
    entries: number;
    not_shipped: number;
    shipped_entries: number;
    pending_review: number;
    eligible: number;
    ineligible: number;
    needs_changes: number;
    approved: number;
  };
  contributors: { approved_hours: number; gross_px: number; uplift_px: number };
  ledger: { net_uplift_px: number; paid_transactions: number };
  pending: { hours: number; gross_usd: number; uplift_max_usd: number };
  participants: number;
  trial_held_skips?: number;
  active_builders_7d: number;
  power_units: number;
  actual_gross_usd: number;
  actual_uplift_usd: number;
  projected_gross_usd: number;
  projected_uplift_max_usd: number;
}

export async function getOperationStats(slug: string): Promise<OperationStats | null> {
  const { data, error } = await db.rpc<OperationStats>("operation_stats", {
    p_slug: slug,
    p_px_value_usd: config.economy.pixelValueUsd,
    p_base_payout_usd: config.economy.basePayoutUsd,
  });
  if (error) console.error("operation_stats failed", error.message);
  return data ?? null;
}

export async function getBlackoutEntry(
  projectId: number,
  slug: string = BLACKOUT_SLUG,
): Promise<BlackoutEntry | null> {
  const op = await getOperation(slug);
  if (!op) return null;
  const { data: e } = await db
    .from("operation_entries")
    .select("*")
    .eq("operation_id", op.id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!e) return null;
  const row = e as Record<string, unknown>;
  const { data: cs } = await db
    .from("operation_entry_contributors")
    .select("*")
    .eq("entry_id", num(row.id))
    .order("id", { ascending: true });
  const contribRows = (cs ?? []) as Record<string, unknown>[];
  const ids = contribRows.map((c) => String(c.user_id));
  const { data: users } = ids.length
    ? await db.from("users").select("id, display_name, real_name").in("id", ids)
    : { data: [] };
  const nameOf = new Map(
    ((users ?? []) as { id: string; display_name: string; real_name: string }[]).map((u) => [
      u.id,
      u.real_name || u.display_name || "player",
    ]),
  );
  return {
    id: num(row.id),
    projectId: num(row.project_id),
    status: row.status as EntryStatus,
    joinedAt: iso(row.joined_at)!,
    windowStart: iso(row.window_start)!,
    firstQualifiedShipAt: iso(row.first_qualified_ship_at),
    latestShipAt: iso(row.latest_ship_at),
    reshipCount: num(row.reship_count),
    rateUsdSnapshot: num(row.rate_usd_snapshot),
    rateModeSnapshot: (row.rate_mode_snapshot as RateMode) ?? "additive",
    gracePeriodHoursSnapshot: num(row.grace_period_hours_snapshot),
    decision: (row.eligibility_decision as "eligible" | "ineligible" | null) ?? null,
    decisionNote: String(row.decision_note ?? ""),
    decidedBy: String(row.decided_by ?? ""),
    decisionStage: String(row.decision_stage ?? ""),
    changesRequestedAt: iso(row.changes_requested_at),
    graceDeadline: iso(row.grace_deadline),
    fixWindowEnd: iso(row.fix_window_end),
    systemReason: String(row.system_reason ?? ""),
    operation: op,
    contributors: contribRows.map((c) => ({
      userId: String(c.user_id),
      name: nameOf.get(String(c.user_id)) ?? "player",
      role: c.role as "owner" | "collaborator",
      hackatimeBaseSeconds: num(c.hackatime_base_seconds),
      journalBaseSeconds: num(c.journal_base_seconds),
      fixTrackedSeconds: num(c.fix_tracked_seconds),
      eligibleTrackedSeconds: num(c.eligible_tracked_seconds),
      evidenceOk: c.evidence_ok !== false,
      evidenceAt: iso(c.evidence_at),
      approvedHours: c.approved_blackout_hours == null ? null : num(c.approved_blackout_hours),
      paidHours: num(c.paid_hours),
      normalUsdRate: c.normal_usd_rate == null ? null : num(c.normal_usd_rate),
      effectiveUsdRate: c.effective_usd_rate == null ? null : num(c.effective_usd_rate),
      grossPx: num(c.gross_px),
      upliftPx: num(c.uplift_px),
      settled: c.settled_at != null,
      settleNote: String(c.settle_note ?? ""),
    })),
  };
}

export async function listBlackoutQueueProjectIds(slug: string = BLACKOUT_SLUG): Promise<number[]> {
  const op = await getOperation(slug);
  if (!op) return [];
  const { data } = await db
    .from("operation_entries")
    .select("project_id")
    .eq("operation_id", op.id)
    .in("status", ["shipped", "eligible", "needs_changes"]);
  return ((data ?? []) as { project_id: number | string }[]).map((r) => Number(r.project_id));
}

export interface OperationEntryListItem {
  id: number;
  projectId: number;
  projectName: string;
  ownerName: string;
  status: EntryStatus;
  joinedAt: string;
  firstQualifiedShipAt: string | null;
  eligibleHours: number;
  approvedHours: number;
  paidHours: number;
  upliftPx: number;
  evidenceIncomplete: boolean;
  trialHoldSkipped: boolean;
}

export const TRIAL_HOLD_NOTE = "trial_prize_hold";

export function settleNoteText(note: string): string {
  return note === TRIAL_HOLD_NOTE
    ? "Blackout top-up skipped: Trial prize pending, this person's pixels are held"
    : note;
}

export async function listOperationEntries(
  slug: string,
  opts: { status?: EntryStatus; limit?: number; offset?: number } = {},
): Promise<{ items: OperationEntryListItem[]; total: number }> {
  const op = await getOperation(slug);
  if (!op) return { items: [], total: 0 };
  let q = db
    .from("operation_entries")
    .select("*", { count: "exact" })
    .eq("operation_id", op.id)
    .order("joined_at", { ascending: false });
  if (opts.status) q = q.eq("status", opts.status);
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const { data, count } = await q.range(offset, offset + limit - 1);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { items: [], total: count ?? 0 };

  const projectIds = rows.map((r) => num(r.project_id));
  const entryIds = rows.map((r) => num(r.id));
  const [{ data: projects }, { data: contribs }] = await Promise.all([
    db.from("projects").select("id, name, user_id").in("id", projectIds),
    db.from("operation_entry_contributors").select("*").in("entry_id", entryIds),
  ]);
  const projectRows = (projects ?? []) as { id: number | string; name: string; user_id: string }[];
  const ownerIds = [...new Set(projectRows.map((p) => p.user_id))];
  const { data: owners } = ownerIds.length
    ? await db.from("users").select("id, display_name, real_name").in("id", ownerIds)
    : { data: [] };
  const ownerName = new Map(
    ((owners ?? []) as { id: string; display_name: string; real_name: string }[]).map((u) => [
      u.id,
      u.real_name || u.display_name || "player",
    ]),
  );
  const projectOf = new Map(projectRows.map((p) => [Number(p.id), p]));
  const byEntry = new Map<number, Record<string, unknown>[]>();
  for (const c of (contribs ?? []) as Record<string, unknown>[]) {
    const list = byEntry.get(num(c.entry_id)) ?? [];
    list.push(c);
    byEntry.set(num(c.entry_id), list);
  }
  const items = rows.map((r) => {
    const p = projectOf.get(num(r.project_id));
    const cs = byEntry.get(num(r.id)) ?? [];
    return {
      id: num(r.id),
      projectId: num(r.project_id),
      projectName: p?.name ?? `#${num(r.project_id)}`,
      ownerName: (p && ownerName.get(p.user_id)) ?? "player",
      status: r.status as EntryStatus,
      joinedAt: iso(r.joined_at)!,
      firstQualifiedShipAt: iso(r.first_qualified_ship_at),
      eligibleHours: cs.reduce((s, c) => s + num(c.eligible_tracked_seconds) / 3600, 0),
      approvedHours: cs.reduce((s, c) => s + num(c.approved_blackout_hours), 0),
      paidHours: cs.reduce((s, c) => s + num(c.paid_hours), 0),
      upliftPx: cs.reduce((s, c) => s + num(c.uplift_px), 0),
      evidenceIncomplete: cs.some((c) => c.evidence_ok === false),
      trialHoldSkipped: cs.some((c) => c.settle_note === TRIAL_HOLD_NOTE),
    };
  });
  return { items, total: count ?? items.length };
}

export interface RpcResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await db.rpc<RpcResult>(fn, args);
  if (error || !data) {
    console.error(`[operations] ${fn} failed`, error?.message);
    return { ok: false, error: "server_error" };
  }
  return data;
}

export const operationRpc = {
  reviewDecision: (a: {
    slug: string;
    projectId: number;
    decision: "eligible" | "ineligible";
    note: string;
    by: string;
    stage: "first_pass" | "final";
    hours: { user_id: string; hours: number }[];
  }) =>
    rpc("operation_review_decision", {
      p_slug: a.slug,
      p_project_id: a.projectId,
      p_decision: a.decision,
      p_note: a.note,
      p_by: a.by,
      p_stage: a.stage,
      p_hours: a.hours,
    }),
  requestChanges: (projectId: number) =>
    rpc("operation_request_changes", { p_project_id: projectId }),
  settle: (a: {
    slug: string;
    projectId: number;
    by: string;
    contribs: { user_id: string; normal_usd_rate: number; credit_hours: number; skip_reason?: string }[];
  }) =>
    rpc("operation_settle_entry", {
      p_slug: a.slug,
      p_project_id: a.projectId,
      p_by: a.by,
      p_px_value_usd: config.economy.pixelValueUsd,
      p_contribs: a.contribs,
    }),
  revert: (projectId: number, by: string) =>
    rpc("operation_revert_entry", { p_project_id: projectId, p_by: by }),
  onBan: (projectId: number) => rpc("operation_on_project_ban", { p_project_id: projectId }),
  create: (a: {
    slug: string;
    name: string;
    startsAt: string;
    endsAt: string;
    rateUsd: number;
    rateMode: RateMode;
    graceHours: number;
    by: string;
  }) =>
    rpc("operation_create", {
      p_slug: a.slug,
      p_name: a.name,
      p_starts_at: a.startsAt,
      p_ends_at: a.endsAt,
      p_rate_usd: a.rateUsd,
      p_rate_mode: a.rateMode,
      p_grace_hours: a.graceHours,
      p_actor: a.by,
    }),
  adminUpdate: (a: {
    slug: string;
    action: "pause" | "resume" | "extend" | "end" | "edit";
    by: string;
    endsAt?: string | null;
    startsAt?: string | null;
    name?: string | null;
    rateUsd?: number | null;
    rateMode?: RateMode | null;
    graceHours?: number | null;
    note?: string;
  }) =>
    rpc("operation_admin_update", {
      p_slug: a.slug,
      p_action: a.action,
      p_actor: a.by,
      p_ends_at: a.endsAt ?? null,
      p_starts_at: a.startsAt ?? null,
      p_name: a.name ?? null,
      p_rate_usd: a.rateUsd ?? null,
      p_grace_hours: a.graceHours ?? null,
      p_note: a.note ?? "",
      p_rate_mode: a.rateMode ?? null,
    }),
};

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  entered: "Entered",
  shipped: "Shipped, awaiting review",
  eligible: "Eligible",
  needs_changes: "Changes requested",
  approved: "Approved",
  ineligible: "Ineligible",
};

export function fmtHoursFromSeconds(seconds: number): string {
  const h = seconds / 3600;
  return `${Math.round(h * 100) / 100}h`;
}

export function maxApprovableHours(c: Pick<BlackoutContributor, "eligibleTrackedSeconds">): number {
  return Math.round((c.eligibleTrackedSeconds / 3600) * 100) / 100;
}

export const ERROR_TEXT: Record<string, string> = {
  invalid_decision: "Pick eligible or ineligible.",
  reason_required: "Say why this entry is ineligible.",
  no_entry: "This project has no Blackout entry.",
  not_shipped_for_operation: "This entry never shipped inside the operation window.",
  entry_locked: "This Blackout entry is already settled and can't be changed.",
  exceeds_eligible: "Approved Blackout hours can't exceed the tracked time inside the window.",
  invalid_hours: "Blackout hours must be a number of 0 or more.",
  unknown_contributor: "That person isn't credited on this Blackout entry.",
  server_error: "Something went wrong saving the Blackout decision.",
};
