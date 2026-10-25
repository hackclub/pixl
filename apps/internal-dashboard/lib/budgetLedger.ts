// Owner-entered, audit-trailed accounting notes using the installed,
// indexed audit_log event stream. No migration or separate storage service.
// These are owner-reported amounts, never bank-verified transactions.
import { sql } from "@/lib/pgCompat";

export type LedgerDirection = "income" | "expense";
export type LedgerState = "settled" | "planned";

export interface BudgetLedgerEntry {
  id: number;
  direction: LedgerDirection;
  state: LedgerState;
  label: string;
  note: string;
  amountCents: number;
  occurredOn: string;
  createdBy: string;
  createdAt: string;
  voidedBy: string | null;
  voidReason: string | null;
}

const ENTRY = "budget.manual.entry";
const VOID = "budget.manual.void";
const APP = "internal-dashboard";
const number = (v: unknown) => Number(v ?? 0) || 0;

export function parseMoneyCents(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) return null;
  const [d, c = ""] = value.split(".");
  const amount = Number(d) * 100 + Number(c.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function parseBudgetDate(raw: string, allowFuture: boolean, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw &&
    (allowFuture || date.getTime() <= now.getTime());
}

export function summarizeManualLedger(entries: readonly BudgetLedgerEntry[]) {
  let settledIncomeCents = 0;
  let settledExpenseCents = 0;
  let plannedIncomeCents = 0;
  let plannedExpenseCents = 0;
  for (const row of entries) {
    if (row.voidedBy) continue;
    if (row.state === "planned") {
      if (row.direction === "income") plannedIncomeCents += row.amountCents;
      else plannedExpenseCents += row.amountCents;
    } else if (row.direction === "income") settledIncomeCents += row.amountCents;
    else settledExpenseCents += row.amountCents;
  }
  return { settledIncomeCents, settledExpenseCents, plannedIncomeCents, plannedExpenseCents };
}

export async function getManualLedger(query: typeof sql = sql): Promise<BudgetLedgerEntry[]> {
  const rows = await query<{
    id: string; at: Date | string; action: string; actor_id: string | null;
    meta: string;
  }[]>`
    SELECT id::text, at, action, actor_id, meta::text AS meta
    FROM audit_log
    WHERE app = ${APP} AND action IN (${ENTRY}, ${VOID}) AND result = 'ok'
    ORDER BY id ASC
  `;
  const entries = new Map<number, BudgetLedgerEntry>();
  const corrections: { id: number; by: string; reason: string }[] = [];
  for (const r of rows) {
    let metadata: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(r.meta);
      metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch {
      continue;
    }
    if (r.action === VOID) {
      const id = number(metadata.entryId);
      if (Number.isSafeInteger(id) && id > 0) {
        corrections.push({ id, by: r.actor_id ?? "unknown", reason: String(metadata.reason ?? "") });
      }
      continue;
    }
    const id = number(r.id);
    const amountCents = number(metadata.amountCents);
    const direction = metadata.direction;
    const state = metadata.state;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(amountCents) || amountCents <= 0) continue;
    if (direction !== "income" && direction !== "expense") continue;
    if (state !== "planned" && state !== "settled") continue;
    entries.set(id, {
      id, direction, state, label: String(metadata.label ?? ""), note: String(metadata.note ?? ""),
      amountCents, occurredOn: String(metadata.occurredOn ?? "").slice(0, 10),
      createdBy: r.actor_id ?? "unknown",
      createdAt: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      voidedBy: null, voidReason: null,
    });
  }
  for (const c of corrections) {
    const entry = entries.get(c.id);
    if (entry && !entry.voidedBy) {
      entry.voidedBy = c.by;
      entry.voidReason = c.reason;
    }
  }
  return [...entries.values()].sort((a, b) => b.id - a.id);
}

export async function recordManualBudgetEntry(input: {
  direction: LedgerDirection; state: LedgerState; label: string;
  note: string; amountCents: number; occurredOn: string; actor: string;
}, query: typeof sql = sql): Promise<void> {
  await query`
    INSERT INTO audit_log (app, actor_type, actor_id, slack_id, action, result, meta)
    VALUES (${APP}, 'staff', ${input.actor}, ${input.actor}, ${ENTRY}, 'ok',
      jsonb_build_object('version', 1, 'direction', ${input.direction}::text,
        'state', ${input.state}::text, 'label', ${input.label}::text, 'note', ${input.note}::text,
        'amountCents', ${input.amountCents}::integer, 'occurredOn', ${input.occurredOn}::text))
  `;
}

export async function voidManualBudgetEntry(id: number, actor: string, reason: string, query: typeof sql = sql): Promise<boolean> {
  // Corrections are separate audit events. Never erase original notes.
  const original = await query<{ found: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM audit_log
      WHERE id = ${id} AND app = ${APP} AND action = ${ENTRY} AND result = 'ok'
    ) AS found
  `;
  if (!original[0]?.found) return false;
  const already = await query<{ found: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM audit_log
      WHERE app = ${APP} AND action = ${VOID} AND result = 'ok'
        AND (meta->>'entryId') = ${String(id)}
    ) AS found
  `;
  if (already[0]?.found) return false;
  await query`
    INSERT INTO audit_log (app, actor_type, actor_id, slack_id, action, target, result, meta)
    VALUES (${APP}, 'staff', ${actor}, ${actor}, ${VOID}, ${"budget:" + id}, 'ok',
      jsonb_build_object('entryId', ${id}::bigint, 'reason', ${reason}::text))
  `;
  return true;
}