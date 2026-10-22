// Read-only: GET Airtable and Ships, optional SELECT-only order history.
import postgres from "postgres";
import { STATUS_FIELD, SUBMITTED_STATUS } from "../lib/airtable";
import { createShipsProvider, repoKeyOf, shipsUrlFromEnv } from "../lib/eligibility/ships";

const BASE = "app80yzut0bdMNdHJ";
const TABLE = "tbl8UpMm6gsLPKEN0";
const API = process.env.AIRTABLE_API_URL ?? "https://api.airtable.com";
const HOURS = "Optional - Override Hours Spent";
const UNIFIED = "Automation - YSWS Record ID";
const token = process.env.AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN;
if (!token) throw new Error("AIRTABLE_PIXL_YSWS_UNIFIED_TOKEN is not set");

interface Row {
  id: string;
  unifiedId: string | null;
  submitted: boolean;
  hours: number | null;
  repoKey: string | null;
}

async function airtableRows(): Promise<Row[]> {
  const out: Row[] = [];
  let offset = "";
  do {
    const q = new URLSearchParams();
    for (const f of ["Code URL", HOURS, STATUS_FIELD, UNIFIED]) q.append("fields[]", f);
    if (process.env.AIRTABLE_VIEW) q.set("view", process.env.AIRTABLE_VIEW);
    if (offset) q.set("offset", offset);
    const res = await fetch(`${API}/v0/${BASE}/${TABLE}?${q}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const body = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[]; offset?: string };
    for (const r of body.records) {
      const h = r.fields[HOURS];
      out.push({
        id: r.id,
        unifiedId: typeof r.fields[UNIFIED] === "string" && /^rec[A-Za-z0-9]{14}$/.test((r.fields[UNIFIED] as string).trim()) ? (r.fields[UNIFIED] as string).trim() : null,
        submitted: r.fields[STATUS_FIELD] === SUBMITTED_STATUS,
        hours: typeof h === "number" ? h : null,
        repoKey: repoKeyOf(typeof r.fields["Code URL"] === "string" ? (r.fields["Code URL"] as string) : null),
      });
    }
    offset = body.offset ?? "";
  } while (offset);
  return out;
}

const provider = createShipsProvider({ url: shipsUrlFromEnv(process.env.SHIPS_API_URL) });
await provider.refresh(true);
const view = provider.view();
if (!view.snapshot) throw new Error(`Ships unavailable: ${view.error}`);
const ships = view.snapshot;

const all = await airtableRows();
const submitted = all.filter((r) => r.submitted);
const matched = submitted.filter((r) => r.unifiedId && ships.byId.has(r.unifiedId));
const unmapped = submitted.filter((r) => !r.unifiedId);
const missing = submitted.filter((r) => r.unifiedId && !ships.byId.has(r.unifiedId));
const shipsOnly = [...ships.byId.values()].filter((e) => !submitted.some((r) => r.unifiedId === e.id));
const discrepancies = matched
  .map((r) => ({ staging: r.id, unified: r.unifiedId, airtable: r.hours, ships: ships.byId.get(r.unifiedId!)!.hours }))
  .filter((d) => d.airtable != null && Math.abs(d.airtable - d.ships) > 1e-9);
const noHours = matched.filter((r) => r.hours == null).map((r) => r.id);
const ambiguous = submitted.filter((r) => r.unifiedId && (ships.ambiguousIds.has(r.unifiedId) || ships.invalidIds.has(r.unifiedId))).map((r) => r.id);
const repoMismatch = matched.filter((r) => r.repoKey && ships.byId.get(r.unifiedId!)!.repoKey !== r.repoKey).map((r) => r.id);

const report: Record<string, unknown> = {
  shipsFetchedAt: new Date(view.fetchedAt!).toISOString(),
  shipsPixlEntries: ships.pixlCount,
  airtableRecords: all.length,
  airtableSubmitted: submitted.length,
  matched: matched.length,
  matchedIds: matched.map((r) => ({ staging: r.id, unified: r.unifiedId })),
  submittedWithoutUnifiedId: unmapped.map((r) => r.id),
  submittedMissingFromShips: missing.map((r) => ({ staging: r.id, unified: r.unifiedId, airtableHours: r.hours })),
  shipsMissingFromAirtableSubmitted: shipsOnly.map((e) => ({ id: e.id, hours: e.hours, inAirtableUnsubmitted: all.some((r) => r.unifiedId === e.id) })),
  hourDiscrepancies: discrepancies,
  matchedWithoutAirtableHours: noHours,
  ambiguous,
  repoMismatch,
};

const slacks = process.argv.slice(2).filter((a) => /^U[A-Z0-9]{6,}$/.test(a));
if (slacks.length > 0) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1 });
  report.players = await sql.begin("read only", async (tx) => {
    const res: unknown[] = [];
    for (const slack of slacks) {
      const [u] = await tx`select id from users where slack_id = ${slack}`;
      if (!u) {
        res.push({ slack, found: false });
        continue;
      }
      const projects = await tx`select id, name, status, approved_hours, prior_approved_hours, airtable_record_id, funding_usd, needs_funding, funding_deducted_px from projects where user_id = ${u.id}`;
      const orders = await tx`select id, item_name, quantity, price, status, actual_cost_usd from shop_orders where user_id = ${u.id} order by id`;
      const payouts = await tx`select project_id, reason, amount, hours from pixel_transactions where user_id = ${u.id} and project_id is not null and reason in ('project_approved', 'review_reverted') order by id`;
      const [reg] = await tx`select to_regclass('public.fulfillment_commitments') as t`;
      const ledger = reg?.t
        ? await tx`select order_id, amount_cents, basis, verdict from fulfillment_commitments where user_id = ${u.id}`
        : [];
      res.push({ slack, projects, payouts, orders, ledger });
    }
    return res;
  });
  await sql.end();
}
console.log(JSON.stringify(report, null, 2));
