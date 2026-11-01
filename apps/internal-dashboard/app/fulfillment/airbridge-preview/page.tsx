import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { readAirbridgeCache } from "@/lib/eligibility/airbridgeCache";
import { sql } from "@/lib/pgCompat";
import { PageHeader, Callout, Card, CardHeader, Table, ButtonLink } from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

interface Row {
  staging_id: string;
  mapping_state: string;
  unified_id: string | null;
  unified_state: string;
  approved_hours: number | string | null;
  otter_identity_blocked: boolean;
  verified_at_ms: number | string;
  last_attempt_ms: number | string;
  error: string | null;
}

function ago(value: number | string, now: number): string {
  const ms = Number(value);
  if (!ms) return "Never";
  const delta = Math.max(0, Math.round((now - ms) / 60000));
  return delta < 1 ? "Just now" : `${delta}m ago`;
}

export default async function AirbridgePreview() {
  // Diagnostic access is owner-only. No actions or mutation endpoints are
  // exposed by this page; any sync writes occur only in the cron worker.
  await requirePage("owner");
  const view = await readAirbridgeCache();
  const now = Date.now();
  const rows = await sql<Row[]>`
    select staging_id, mapping_state, unified_id, unified_state,
      approved_hours, otter_identity_blocked, verified_at_ms,
      last_attempt_ms, error
    from fulfillment_unified_cache
    order by
      case when error is not null then 0
        when otter_identity_blocked then 1
        when unified_state = 'missing' then 2
        when mapping_state <> 'mapped' then 3
        else 4 end, last_attempt_ms asc
    limit 100
  `;
  const health = view.snapshot?.syncHealth;
  const active = process.env.FULFILLMENT_SHIPS_SOURCE === "airbridge";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Airbridge verification preview"
        description="Read-only diagnostics from the local PostgreSQL approval cache. This page never changes eligibility, payouts or orders."
        actions={<ButtonLink href="/fulfillment" size="sm" variant="outline" icon="list">Back to fulfillment</ButtonLink>}
      />
      <Callout tone="info" icon="analytics">
        {active ? "The Airbridge verification source is enabled for the live dashboard." :
          "Testing mode: the live fulfillment dashboard and order claim checks still use the existing Ships provider."}
        {" "}This preview only reads cached data and has no payment or order actions.
      </Callout>
      <Card>
        <CardHeader title="Synchronization health" icon="analytics" />
        {view.error && <p className="text-sm">{view.error}</p>}
        {health ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {[
              ["Active staging records", health.total],
              ["Currently verified", health.current],
              ["Not yet synchronized", health.unsynced],
              ["Stale records", health.stale],
              ["Upstream errors", health.errors],
              ["Identity review", health.identityReview],
              ["Approved cache entries", view.snapshot?.pixlCount ?? 0],
              ["Conflicting Unified IDs", view.snapshot?.duplicateCount ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-current/10 p-3">
                <div className="text-xs opacity-70">{label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm">Cache health unavailable.</p>}
      </Card>
      <Card padding="flush">
        <CardHeader title="Cached staging evidence" icon="list" count={rows.length} />
        <p className="px-4 pb-3 text-xs opacity-70">
          Showing at most 100 records, with errors and exceptions first.
          Missing Unified approvals and absent mappings are intentionally not counted as verified credits.
        </p>
        <Table headers={["Staging record", "Mapping", "Unified approval", "Hours", "Identity", "Last checked"]}>
          {rows.map(r => (
            <tr key={r.staging_id}>
              <td className="font-mono text-xs">{r.staging_id}</td>
              <td>{r.mapping_state}</td>
              <td>
                <span className="text-xs">{r.unified_state}</span>
                {r.unified_id && <div className="font-mono text-xs opacity-70">{r.unified_id}</div>}
                {r.error && <div className="text-xs text-red-600">{r.error}</div>}
              </td>
              <td className="tabular-nums">{r.approved_hours ?? "—"}</td>
              <td>{r.otter_identity_blocked ? "Review required" : "No block"}</td>
              <td>{ago(r.verified_at_ms, now)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <p className="text-xs opacity-70">
        All values are a snapshot at page load. <Link className="underline" href="/fulfillment/airbridge-preview">Reload diagnostics</Link> to check new sync results.
      </p>
    </div>
  );
}
