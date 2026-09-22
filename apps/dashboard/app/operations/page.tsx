import Link from "next/link";
import { requirePagePerm } from "@/lib/guard";
import { db } from "@/lib/db";
import {
  BLACKOUT_SLUG,
  ENTRY_STATUSES,
  ENTRY_STATUS_LABEL,
  getOperation,
  getOperationStats,
  listOperationEntries,
  type EntryStatus,
  type OperationRow,
} from "@/lib/operations";
import { createOperation, operationControl } from "@/app/operations/actions";
import { BlackoutBadge } from "@/app/_components/BlackoutBadge";
import { PendingButton } from "@/app/_components/PendingButton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const PER = 20;

const STATUS_TONE: Record<OperationRow["effectiveStatus"], "success" | "warning" | "secondary" | "destructive"> = {
  active: "success",
  paused: "warning",
  upcoming: "secondary",
  ended: "destructive",
};

const ENTRY_TONE: Record<EntryStatus, "secondary" | "warning" | "info" | "success" | "destructive" | "violet"> = {
  entered: "secondary",
  shipped: "warning",
  eligible: "info",
  needs_changes: "violet",
  approved: "success",
  ineligible: "destructive",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
const inputValue = (iso: string) => new Date(iso).toISOString().slice(0, 16);
const actorLabel = (actor: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(actor) ? "player" : actor.replace(/\s*\([^)]*\)\s*$/, "") || "system";
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const hrs = (n: number) => `${Math.round(n * 100) / 100}h`;

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4 gap-1">
      <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums leading-tight">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function CreateForm() {
  return (
    <Card className="p-5 md:p-6 gap-0 max-w-2xl">
      <div className="text-base font-semibold mb-1">Create Operation Blackout</div>
      <p className="text-xs text-muted-foreground mb-4">
        Nothing is live until the start time. Entries open at the start and close at the end. All times UTC.
      </p>
      <form action={createOperation} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm sm:col-span-2">
          Name
          <Input name="name" defaultValue="Operation Blackout" required maxLength={80} />
        </label>
        <label className="grid gap-1 text-sm">
          Slug
          <Input name="slug" defaultValue={BLACKOUT_SLUG} required pattern="[a-z0-9][a-z0-9\-]{0,63}" />
        </label>
        <label className="grid gap-1 text-sm">
          Bonus ($/hr)
          <Input name="rateUsd" type="number" step="0.01" min="0" defaultValue="1" required />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Rate mode</span>
          <select
            name="rateMode"
            defaultValue="additive"
            className="w-full text-sm h-9 rounded-md border border-border bg-background px-3"
          >
            <option value="additive">Additive - flat bonus on top of each player&apos;s own rate</option>
            <option value="floor">Floor - nobody drops below this rate</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Starts (UTC)
          <Input name="startsAt" type="datetime-local" required />
        </label>
        <label className="grid gap-1 text-sm">
          Ends (UTC)
          <Input name="endsAt" type="datetime-local" required />
        </label>
        <label className="grid gap-1 text-sm">
          Grace period after changes are requested (hours)
          <Input name="graceHours" type="number" min="0" defaultValue="72" required />
        </label>
        <div className="sm:col-span-2">
          <PendingButton pendingText="Creating…">Create operation</PendingButton>
        </div>
      </form>
    </Card>
  );
}

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; ok?: string; error?: string; status?: string; page?: string }>;
}) {
  await requirePagePerm(["operations"]);
  const sp = await searchParams;
  const slug = sp.slug || BLACKOUT_SLUG;
  const statusFilter = ENTRY_STATUSES.includes(sp.status as EntryStatus) ? (sp.status as EntryStatus) : undefined;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const op = await getOperation(slug);
  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3 flex-wrap">
        Operations <BlackoutBadge />
      </h1>
      <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
        Time-boxed campaigns. Reviewers rule on eligibility and hours; the database works out the pay. All
        times are UTC.
      </p>
    </div>
  );
  const alerts = (
    <>
      {sp.ok && (
        <Alert>
          <AlertDescription className="font-medium text-emerald-600 dark:text-emerald-400">{sp.ok}</AlertDescription>
        </Alert>
      )}
      {sp.error && (
        <Alert variant="destructive">
          <AlertDescription className="font-medium text-destructive">{sp.error}</AlertDescription>
        </Alert>
      )}
    </>
  );

  if (!op) {
    return (
      <div className="space-y-6">
        {header}
        {alerts}
        <CreateForm />
      </div>
    );
  }

  const [stats, list, auditRes] = await Promise.all([
    getOperationStats(slug),
    listOperationEntries(slug, { status: statusFilter, limit: PER, offset: (page - 1) * PER }),
    db
      .from("operation_audit")
      .select("id, actor, action, detail, created_at")
      .eq("operation_id", op.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);
  const audit = (auditRes.data ?? []) as { id: number; actor: string; action: string; created_at: string | Date }[];
  const pages = Math.max(1, Math.ceil(list.total / PER));
  const qs = (p: number, st?: string) => {
    const q = new URLSearchParams();
    if (slug !== BLACKOUT_SLUG) q.set("slug", slug);
    if (st) q.set("status", st);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/operations${s ? `?${s}` : ""}`;
  };
  const eff = op.effectiveStatus;
  const e = stats?.entries;
  const skippedForTrial = Number(stats?.trial_held_skips ?? 0);

  return (
    <div className="space-y-8">
      {header}
      {alerts}

      <Card className="p-5 md:p-6 gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-semibold">{op.name}</span>
              <Badge variant={STATUS_TONE[eff]} className="uppercase tracking-wide text-[0.65rem]">{eff}</Badge>
              {(op.status === "paused" || op.status === "ended") && op.status !== eff && (
                <span className="text-xs text-muted-foreground">(set to {op.status})</span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {fmt(op.startsAt)} → {fmt(op.endsAt)} UTC
            </div>
            <div className="text-sm text-muted-foreground">
              {op.rateMode === "additive"
                ? <>+{usd(op.rateUsd)}/hr bonus, effective rate = player&apos;s own rate + {usd(op.rateUsd)}</>
                : <>Floor rate {usd(op.rateUsd)}/hr, effective rate = max(player&apos;s own rate, {usd(op.rateUsd)})</>}
              {" "}· grace {op.gracePeriodHours}h
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {op.status !== "ended" && eff !== "ended" && op.status !== "paused" && (
              <form action={operationControl}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="action" value="pause" />
                <PendingButton variant="outline" size="sm" pendingText="Pausing…" confirm="Pause new entries? Projects already entered can still ship.">
                  Pause entries
                </PendingButton>
              </form>
            )}
            {op.status === "paused" && (
              <form action={operationControl}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="action" value="resume" />
                <PendingButton size="sm" pendingText="Resuming…">Resume entries</PendingButton>
              </form>
            )}
          </div>
        </div>

        {op.status !== "ended" && eff !== "ended" && (
          <div className="grid gap-4 md:grid-cols-2">
            <form action={operationControl} className="grid gap-2 rounded-lg border border-border p-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="action" value="extend" />
              <div className="text-sm font-medium">Extend the end</div>
              <p className="text-xs text-muted-foreground">
                Only later. Entries keep their recorded join and first-ship times; nothing already decided changes.
              </p>
              <Input name="endsAt" type="datetime-local" required defaultValue={inputValue(op.endsAt)} />
              <div><PendingButton size="sm" variant="outline" pendingText="Saving…">Extend</PendingButton></div>
            </form>
            <form action={operationControl} className="grid gap-2 rounded-lg border border-rose-200 dark:border-rose-500/30 p-3">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="action" value="end" />
              <div className="text-sm font-medium">End the operation now</div>
              <p className="text-xs text-muted-foreground">
                Closes it immediately. Entries that already shipped are still reviewed and paid; unshipped ones can&apos;t qualify.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="confirmEnd" value="1" /> I understand this can&apos;t be undone
              </label>
              <div>
                <PendingButton size="sm" variant="outline" pendingText="Ending…" className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:text-rose-600">
                  End now
                </PendingButton>
              </div>
            </form>
          </div>
        )}

        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Edit name, rate, grace</summary>
          <form action={operationControl} className="grid gap-3 sm:grid-cols-3 mt-3">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="action" value="edit" />
            <label className="grid gap-1 text-sm sm:col-span-3">
              Name
              <Input name="name" defaultValue={op.name} maxLength={80} />
            </label>
            <label className="grid gap-1 text-sm">
              Bonus ($/hr)
              <Input name="rateUsd" type="number" step="0.01" min="0" defaultValue={op.rateUsd} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>Rate mode</span>
              <select
                name="rateMode"
                defaultValue={op.rateMode}
                className="w-full text-sm h-9 rounded-md border border-border bg-background px-3"
              >
                <option value="additive">Additive - flat bonus</option>
                <option value="floor">Floor - minimum rate</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Grace (hours)
              <Input name="graceHours" type="number" min="0" defaultValue={op.gracePeriodHours} />
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Rate, rate mode, and grace apply only to entries created after this save; each entry snapshots them
              when it joins. The start can only move before anything has joined.
            </p>
            <div className="sm:col-span-3"><PendingButton size="sm" pendingText="Saving…">Save</PendingButton></div>
          </form>
        </details>
      </Card>

      {stats && e && (
        <>
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Entries</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Entered" value={e.entries} hint={`${e.not_shipped} not shipped yet`} />
              <Stat label="Shipped" value={e.shipped_entries} />
              <Stat label="Pending review" value={e.pending_review} hint="shipped or ruled, awaiting final" />
              <Stat label="Changes requested" value={e.needs_changes} hint="in the grace window" />
              <Stat label="Eligible" value={e.eligible} />
              <Stat label="Ineligible" value={e.ineligible} />
              <Stat label="Approved" value={e.approved} />
              <Stat label="Participants" value={stats.participants} hint={`${stats.active_builders_7d} journaling in the last 7d`} />
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Blackout cost (top-up only)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Blackout cost paid" value={usd(stats.actual_uplift_usd)} hint={`extra pixels credited over normal pay, net of reversals · ${stats.ledger.paid_transactions} payouts`} />
              <Stat label="Pending cost (max)" value={usd(Number(stats.pending.uplift_max_usd))} hint="most the unpaid entries could still add" />
              <Stat label="Projected cost (max)" value={usd(stats.projected_uplift_max_usd)} hint="paid + pending max" />
              <Stat label="Trial-held skips" value={skippedForTrial} hint="owner top-ups skipped, Trial prize pending" />
            </div>
            <div className="text-sm font-medium text-muted-foreground mt-6 mb-3">Work value (not extra cost)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Approved hours" value={hrs(Number(stats.contributors.approved_hours))} hint={`power restored: ${Math.round(Number(stats.power_units))} units`} />
              <Stat label="Approved work value" value={usd(stats.actual_gross_usd)} hint="approved hours × effective rate; mostly paid by normal payouts" />
              <Stat label="Pending hours" value={hrs(Number(stats.pending.hours))} hint="upper bound, not yet approved" />
              <Stat label="Pending work value" value={usd(Number(stats.pending.gross_usd))} hint="if every pending hour is approved" />
            </div>
            <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
              Blackout cost means only the top-up. Each person&apos;s normal project payout already pays their hours at
              their own rate, so the operation adds just the difference on top.{" "}
              {op.rateMode === "additive"
                ? <>Every eligible contributor gets the same flat +{usd(Number(op.rateUsd))}/hr, whether their own rate
                    is $4, $5, or $6/hr - nobody is left out for already being above some minimum.</>
                : <>Below the {usd(Number(op.rateUsd))}/hr floor, the difference is added; at or above it, nothing extra.</>}
              {" "}Work value is the total those hours are worth at the effective rate, for context. Pending hours are a
              ceiling from tracked time inside each entry&apos;s window, not yet approved
              {op.rateMode === "additive" && "; the pending cost figure itself is exact for the bonus (it doesn't depend on anyone's real rate), not an estimate"}.
            </p>
          </div>
        </>
      )}

      <div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-sm font-medium text-muted-foreground mr-1">Entries</span>
          <Button asChild variant="ghost" size="sm" className={!statusFilter ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}>
            <Link href={qs(1)}>All</Link>
          </Button>
          {ENTRY_STATUSES.map((s) => (
            <Button key={s} asChild variant="ghost" size="sm" className={statusFilter === s ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}>
              <Link href={qs(1, s)}>{ENTRY_STATUS_LABEL[s]}</Link>
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          {list.items.map((it) => (
            <Link key={it.id} href={`/projects/${it.projectId}`} className="block">
              <Card className="p-3.5 gap-1 hover:bg-muted/40">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{it.projectName}</span>
                  <Badge variant={ENTRY_TONE[it.status]} className="uppercase tracking-wide text-[0.65rem]">
                    {ENTRY_STATUS_LABEL[it.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{it.ownerName}</span>
                  {it.evidenceIncomplete && <Badge variant="destructive" className="text-[0.65rem]">Hackatime incomplete</Badge>}
                  {it.trialHoldSkipped && <Badge variant="warning" className="text-[0.65rem]">Top-up skipped: Trial hold</Badge>}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>joined {fmt(it.joinedAt)}</span>
                  <span>{it.firstQualifiedShipAt ? `shipped ${fmt(it.firstQualifiedShipAt)}` : "not shipped"}</span>
                  <span>{hrs(it.eligibleHours)} in window</span>
                  {it.approvedHours > 0 && <span>{hrs(it.approvedHours)} ruled</span>}
                  {it.paidHours > 0 && <span>{hrs(it.paidHours)} paid (+{it.upliftPx} px)</span>}
                </div>
              </Card>
            </Link>
          ))}
          {list.items.length === 0 && (
            <Card className="p-5 text-sm text-muted-foreground">No entries{statusFilter ? " with that status" : " yet"}.</Card>
          )}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm mt-4">
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Button asChild variant="outline" size="sm"><Link href={qs(page - 1, statusFilter)}>Previous</Link></Button>}
              {page < pages && <Button asChild variant="outline" size="sm"><Link href={qs(page + 1, statusFilter)}>Next</Link></Button>}
            </div>
          </div>
        )}
      </div>

      {audit.length > 0 && (
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-3">Audit trail</div>
          <Card className="divide-y divide-border py-0">
            {audit.map((a) => (
              <div key={a.id} className="p-3 text-xs flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                <span className="font-medium text-foreground">{a.action.replaceAll("_", " ")}</span>
                <span className="text-muted-foreground">{actorLabel(a.actor)}</span>
                <span className="text-muted-foreground ml-auto">{fmt(new Date(a.created_at).toISOString())} UTC</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
