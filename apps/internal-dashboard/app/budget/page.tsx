import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { getBudgetData } from "@/lib/budget";
import { BUDGET_CATEGORIES, type Direction } from "@/lib/budgetMath";
import { config } from "@/app/_generated/config";
import { addBudgetEntry, voidBudgetRecord } from "./actions";
import {
  ActionButton, Badge, Callout, Card, CardHeader, EmptyRow, Field, Flash,
  Input, NativeSelect, PageHeader, Stat, StatGrid, Table, Textarea,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const px = (amount: number) => `${amount.toLocaleString("en-US")} px`;
const nominalUsd = (amount: number) => money(Math.round(amount * config.economy.pixelValueUsd * 100));
const today = () => new Date().toISOString().slice(0, 10);

function RecordForm({ direction }: { direction: Direction }) {
  const expense = direction === "expense";
  return (
    <Card>
      <CardHeader title={expense ? "Record an expense" : "Record funding received"} icon={expense ? "payment" : "bank"} />
      <form action={addBudgetEntry} className="grid gap-3">
        <input type="hidden" name="direction" value={direction} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <NativeSelect name="category" required defaultValue={expense ? "contractor" : "program_funding"}>
              {Object.entries(BUDGET_CATEGORIES).filter(([, info]) => info.direction === direction)
                .map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect name="state" defaultValue="settled">
              <option value="settled">{expense ? "Paid" : "Received"} (actual)</option>
              <option value="planned">Planned / pending</option>
            </NativeSelect>
          </Field>
          <Field label="Amount (USD)">
            <Input name="amountUsd" type="number" min="0.01" max="999999999" step="0.01" placeholder="0.00" required />
          </Field>
          <Field label="Date">
            <Input name="occurredOn" type="date" defaultValue={today()} required />
          </Field>
        </div>
        <Field label="What was this for?">
          <Input name="title" placeholder={expense ? "e.g. Security bounty for approved report" : "e.g. Program operating grant"} minLength={3} maxLength={140} required />
        </Field>
        <Field label="Notes (optional)">
          <Textarea name="description" rows={2} maxLength={2000} placeholder="Invoice, recipient, approval details, etc." />
        </Field>
        <Field label="Evidence URL (optional)">
          <Input name="evidenceUrl" type="url" maxLength={500} placeholder="https://..." />
        </Field>
        <p className="hc-caption text-xs">
          This records an accounting entry only; it does not send money or pixels.
          {expense ? " Shop purchases already tracked by PIXL must not be entered again." : ""}
        </p>
        <div><ActionButton pendingLabel="Saving..." icon="plus">Record {expense ? "expense" : "income"}</ActionButton></div>
      </form>
    </Card>
  );
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePage("owner");
  if (await getLiveMode()) return <LiveBlocked what="Budget" reason="This page contains private financial and payment information." />;
  const { error, ok } = await searchParams;
  const data = await getBudgetData();
  const categ = (key: string, state: "settled" | "planned" = "settled") =>
    data.categories.filter((r) => r.category === key && r.state === state).reduce((s, r) => s + r.totalCents, 0);
  const shopNotRecorded = data.shop.missingActualCost > 0;
  const reviewerCounts = data.reviewers.length;
  const valueRedeemed = nominalUsd(data.shop.redeemedPx);
  const marginProxy = Math.round(data.shop.redeemedPx * config.economy.pixelValueUsd * 100) - data.shopSpentCents;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Budget" description="PIXL financial overview. Actual USD transactions are kept separate from pixels, forecasts, and estimated reward value." />
      <Flash error={error} ok={ok} />
      {!data.ledgerAvailable && (
        <Callout tone="warning" icon="info">
          <strong>Accounting setup pending approval.</strong> The automatic shop and reviewer reports below work now,
          but the private USD ledger is not installed. Migration <code>0232_budget_entries.sql</code> must be reviewed and explicitly
          approved before any income, fines, contractor invoices, or bounties can be recorded here.
          Nothing has been written to the production database.
        </Callout>
      )}
      <Callout tone="info" icon="info">
        <strong>This is not verified company profit.</strong> Pixels players earn or redeem are virtual reward accounting, not incoming cash.
        Record grants/sponsorship actually received, contractor invoices, fines, security bounty payments and other cash outflows below.
        The net figure is a <strong>partial recorded balance</strong> until all funding, liabilities, cash expenses and external accounts are reconciled.
      </Callout>

      <StatGrid>
        <Stat icon="bank" label="Funding received (recorded)" value={data.ledgerAvailable ? money(data.incomeCents) : "Not connected"} hint="Only settled USD income entered in Budget" />
        <Stat icon="payment" label="Shop fulfillment cost" value={money(data.shopSpentCents)} hint={`${data.shop.ordersWithActualCost} orders with actual USD cost recorded`} />
        <Stat icon="list" label="Other recorded spending" value={data.ledgerAvailable ? money(data.manualExpensesCents) : "Not connected"} hint="Contractors, bounties, fines, hosting, etc." />
        <Stat
          icon="analytics"
          label="Partial recorded balance"
          value={data.ledgerAvailable && data.hasRecordedIncome ? money(data.recordedNetCents) : "Not available"}
          tone={data.ledgerAvailable && data.hasRecordedIncome ? (data.recordedNetCents >= 0 ? "success" : "danger") : "neutral"}
          hint="Recorded income minus actual shop costs and settled manual expenses; not audited profit"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Expense breakdown" icon="payment" />
          <Table headers={["Cash cost", "Recorded actual"]}>
            <tr><td>Shop orders (automatic)</td><td className="font-bold tabular-nums">{money(data.shopSpentCents)}</td></tr>
            {Object.entries(BUDGET_CATEGORIES).filter(([, c]) => c.direction === "expense").map(([key, c]) => (
              <tr key={key}><td>{c.label}</td><td className="tabular-nums">{data.ledgerAvailable ? money(categ(key)) : "—"}</td></tr>
            ))}
            <tr><td className="font-bold">Total recorded spending</td><td className="font-bold tabular-nums">{data.ledgerAvailable ? money(data.totalExpensesCents) : "Incomplete"}</td></tr>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Incoming funding & plans" icon="bank" />
          <Table headers={["Funding source", "Received", "Planned"]}>
            {Object.entries(BUDGET_CATEGORIES).filter(([, c]) => c.direction === "income").map(([key, c]) => (
              <tr key={key}><td>{c.label}</td><td className="tabular-nums">{data.ledgerAvailable ? money(categ(key)) : "—"}</td><td className="tabular-nums">{data.ledgerAvailable ? money(categ(key, "planned")) : "—"}</td></tr>
            ))}
            <tr><td className="font-bold">Total</td><td className="font-bold">{data.ledgerAvailable ? money(data.incomeCents) : "—"}</td><td>{data.ledgerAvailable ? money(data.plannedIncomeCents) : "—"}</td></tr>
          </Table>
          {data.ledgerAvailable && <p className="hc-caption mt-3 text-sm">Planned expenses: {money(data.plannedExpensesCents)} — excluded from actual spending until marked paid.</p>}
        </Card>
      </div>

      <Card>
        <CardHeader title="Shop & project economics" icon="analytics" />
        <StatGrid>
          <Stat label="Fulfilled orders" value={data.shop.ordersWithActualCost.toLocaleString()} hint="Only orders with recorded real costs" />
          <Stat label="Pixels redeemed on these orders" value={px(data.shop.redeemedPx)} hint={`Nominal reward value: ${valueRedeemed}`} />
          <Stat label="Reward value − shop cost" value={money(marginProxy)} tone={marginProxy >= 0 ? "success" : "danger"} hint="Illustrative fulfillment spread, NOT revenue or profit" />
          <Stat label="Project reward pixels issued (net)" value={px(data.projectPayoutPx)} hint={`Nominal value ${nominalUsd(data.projectPayoutPx)}, not a cash payment`} />
        </StatGrid>
        {shopNotRecorded && <Callout tone="warning" icon="info">{data.shop.missingActualCost} processed shop orders lack an actual_cost_usd; spending may be understated.</Callout>}
      </Card>

      <Card>
        <CardHeader title="Reviewers & fulfillment rewards" icon="checkmark" />
        <p className="hc-caption mb-3 text-sm">
          Reviewer and fulfiller compensation below is <strong>pixels credited in-game</strong>, not external contractor payments.
          External USD reviewer payments must be recorded separately in the cash ledger.
        </p>
        <StatGrid>
          <Stat label="Payout records marked paid" value={data.reviewerPaidCount.toLocaleString()} hint={`${data.reviewerPendingCount} pending payout records`} />
          <Stat label="Reviewer pixels (net wallet)" value={px(data.reviewerNetPx)} hint={`Nominal value ${nominalUsd(data.reviewerNetPx)}`} />
          <Stat label="Fulfiller pixels credited" value={px(data.fulfillerNetPx)} hint={`Nominal value ${nominalUsd(data.fulfillerNetPx)}`} />
          <Stat label="Default review reward" value={data.reviewRates ? `${data.reviewRates.approved} px` : "Unavailable"} hint={data.reviewRates ? `Needs changes: ${data.reviewRates.changes} px` : "Review payout settings"} />
        </StatGrid>
        <div className="mt-4">
          <Table headers={["Reviewer", "Paid records", "Pending", "Credited px", "Net reviewer px", "Nominal value"]}>
            {data.reviewers.map((r) => (
              <tr key={r.slackId}>
                <td><Link className="font-bold underline" href={`/reviewers/${encodeURIComponent(r.slackId)}`}>{r.slackId}</Link></td>
                <td className="tabular-nums">{r.paidReviews}</td>
                <td className="tabular-nums">{r.pendingReviews}</td>
                <td className="tabular-nums">{px(r.creditedPx)}</td>
                <td className="font-bold tabular-nums">{px(r.netWalletPx)}</td>
                <td className="tabular-nums">{nominalUsd(r.netWalletPx)}</td>
              </tr>
            ))}
            {reviewerCounts === 0 && <EmptyRow colSpan={6} title="No reviewer payout records found" icon="checkmark" />}
          </Table>
        </div>
        <p className="hc-caption mt-2 text-xs">Net reviewer pixels include payout backfills, reversals and cuts in the player transaction ledger. Different from nominal review payout totals.</p>
      </Card>

      {data.ledgerAvailable ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <RecordForm direction="income" />
            <RecordForm direction="expense" />
          </div>
          <Card>
            <CardHeader title="Financial entry history" icon="list" count={data.ledger.length} />
            <p className="hc-caption px-4 pb-3 text-sm">Latest 100 entries. Voiding keeps the entry and its correction reason for auditability; it never deletes or reverses a real-world payment.</p>
            <Table headers={["Date", "Entry", "Category", "USD", "Status / audit"]}>
              {data.ledger.map((r) => (
                <tr key={r.id} className={r.voidedAt ? "opacity-55" : ""}>
                  <td className="tabular-nums whitespace-nowrap">{r.occurredOn}</td>
                  <td>
                    <div className="font-bold">{r.title}</div>
                    {r.description && <p className="hc-muted text-xs">{r.description}</p>}
                    {r.evidenceUrl && <a href={r.evidenceUrl} rel="noopener noreferrer" target="_blank" className="text-xs underline">Evidence</a>}
                  </td>
                  <td>{BUDGET_CATEGORIES[r.category]?.label ?? r.category}</td>
                  <td className="font-bold tabular-nums whitespace-nowrap">{r.direction === "expense" ? "−" : "+"}{money(r.amountCents)}</td>
                  <td>
                    <Badge tone={r.voidedAt ? "danger" : r.state === "settled" ? "success" : "warning"}>{r.voidedAt ? "Voided" : r.state === "settled" ? "Actual" : "Planned"}</Badge>
                    <div className="hc-muted text-xs">By {r.createdBy}</div>
                    {r.voidedAt ? <div className="hc-muted text-xs">{r.voidReason}</div> : (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer">Correct entry</summary>
                        <form action={voidBudgetRecord} className="mt-2 grid gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <Input name="reason" required minLength={5} maxLength={500} placeholder="Why is this incorrect?" />
                          <ActionButton variant="danger" size="sm" pendingLabel="Voiding...">Void entry</ActionButton>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
              {data.ledger.length === 0 && <EmptyRow colSpan={5} title="No cash transactions recorded yet" icon="bank" />}
            </Table>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader title="Manual accounting ledger" icon="bank" />
          <p className="hc-caption text-sm">Manual entries for grants, contractors, reviewer cash payments, security bounties, fines and other invoices will become available only after the approved schema migration is applied.</p>
        </Card>
      )}
    </div>
  );
}
