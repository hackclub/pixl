import Link from "next/link";
import type { BudgetData } from "@/lib/budget";
import { HCB_URL, type CashLedger } from "@/lib/budgetCash";
import { reserveLines, type BudgetPosition } from "@/lib/budgetPosition";
import { nominalValueCents } from "@/lib/budgetMath";
import { config } from "@/app/_generated/config";
import { Callout, Card, CardHeader, EmptyRow, PageHeader, Stat, StatGrid, Table } from "@/app/_ui/ui";
import { BudgetCharts, RemainingBudget } from "./BudgetCharts";

const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const px = (value: number) => `${value.toLocaleString("en-US")} px`;
const nominal = (value: number) => money(nominalValueCents(value, config.economy.pixelValueUsd));
const timestamp = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";

export function BudgetView({ data, position, cash }: { data: BudgetData; position: BudgetPosition; cash: CashLedger | null }) {
  const reserves = reserveLines(position, config.economy.pixelValueUsd);
  const reservedCents = reserves.reduce((sum, row) => sum + row.cents, 0);
  const openPx = position.pendingOrdersPx + position.orderedPx;
  const cashUsable = cash !== null && cash.reconciled && Date.now() - new Date(cash.fetchedAt).getTime() < 5 * 60_000;
  const remainingCents = cashUsable ? cash.balanceCents - reservedCents : null;

  return (
    <div className="flex min-w-0 flex-col gap-6 [&>*]:min-w-0">
      <PageHeader title="Budget" description="Cash, rewards still owed, and what remains. All dollar amounts are USD." />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm hc-caption">
        <span>Rewards read {timestamp(position.readAt)}. {cash ? `HCB read ${timestamp(cash.fetchedAt)}; cached for one minute. Reload to refresh.` : "HCB connection unavailable."}</span>
        <a className="font-bold underline" href={HCB_URL} target="_blank" rel="noreferrer">Open HCB ledger</a>
      </div>

      <StatGrid>
        <Stat icon="bank" label="Cash in HCB" value={cash ? money(cash.balanceCents) : "Unavailable"}
          hint="Includes HCB's displayed pending transactions" />
        <Stat icon="bank" label="In people's wallets" value={nominal(position.walletsPx)}
          hint={`${px(position.walletsPx)} unredeemed; positive balances only`} />
        <Stat icon="package" label="Orders left to fulfil" value={nominal(openPx)}
          hint={`${px(openPx)} across ${position.pendingOrders + position.orderedOrders} new, claimed or ordered records`} />
        <Stat icon="payment" label="Remaining estimate" value={remainingCents === null ? "Unavailable" : money(remainingCents)}
          tone={remainingCents !== null && remainingCents < 0 ? "danger" : "neutral"}
          hint="After all reward reserves below; before unknown costs" />
      </StatGrid>

      {!cashUsable && <Callout tone="warning" icon="info">The remaining estimate is unavailable until HCB is reachable, recent, and its transaction ledger matches the balance. Wallet and order totals below are still current database reads.</Callout>}
      <Callout tone="info" icon="info">
        <strong>{px(10)} = {nominal(10)}.</strong> Reviewer rewards of {px(data.reviewerNetPx)} mean {nominal(data.reviewerNetPx)}, not {money(data.reviewerNetPx * 100)}.
        Credited rewards are already in wallets or redeemed orders. We count them once.
      </Callout>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="What we still need to cover" icon="bank" />
          <BudgetCharts kind="obligations" rows={reserves.map((row) => ({ label: row.label, value: row.cents }))} />
          <Table headers={["Reserve", "Pixels", "USD equivalent"]}>
            {reserves.map((row) => <tr key={row.label}><td>{row.label}</td><td className="tabular-nums">{px(row.pixels)}</td><td className="tabular-nums">{money(row.cents)}</td></tr>)}
            <tr className="font-bold"><td>Total reserved</td><td>Counted once</td><td>{money(reservedCents)}</td></tr>
          </Table>
          <p className="hc-caption mt-3 text-xs">Orders use their total pixel price, including quantity. Ordered prizes may already have HCB debits, so their full reserve is conservative. Actual purchasing and shipping costs can differ.</p>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Remaining budget" icon="payment" />
          <RemainingBudget cashCents={cashUsable ? cash.balanceCents : null} reservedCents={reservedCents} />
          <p className="hc-caption mt-4 text-sm">Recorded fines, paid bounties, contractors and other HCB expenses already reduce cash. They are not deducted again. Any additional unpaid RCE bounty or unrecorded bill still needs reserving.</p>
          <div className="mt-4 rounded-lg border border-current/15 p-4 text-sm">
            <strong>Estimate, not final profit.</strong> Future projects, funding and operating costs are excluded. The extra-cost field is a local scenario and is not saved.
          </div>
        </Card>
      </div>

      {cash && <Card className="min-w-0">
        <CardHeader title="Where cash has gone" icon="payment" />
        <StatGrid>
          <Stat label="All cash received" value={money(cash.incomingCents)} hint="Includes returned grants and incoming transfers" />
          <Stat label="All cash sent" value={money(cash.outgoingCents)} hint="Includes grants, purchases, transfers and pending debits" />
          <Stat label="Ledger check" value={cash.reconciled ? "Matches HCB" : "Needs reconciliation"} hint={`${cash.transactionCount} entries; received minus sent = ${money(cash.incomingCents - cash.outgoingCents)}`} />
        </StatGrid>
        <BudgetCharts kind="expenses" rows={cash.spending.map((row) => ({ label: row.label, value: row.cents }))} />
        <p className="hc-caption text-xs">Categories use HCB tags and transfer descriptions. Untagged payments stay in Other expenses. This chart shows cash movements, including grants and budget transfers, rather than accounting profit.</p>
      </Card>}

      <Card className="min-w-0">
        <CardHeader title="Shop spending over time" icon="analytics" />
        <p className="mb-3 text-sm"><strong>{px(position.fulfilledPx)}</strong> redeemed in {position.fulfilledOrders} credited, shipped or completed orders ({nominal(position.fulfilledPx)} in reward value). Open orders are reserved above.</p>
        <BudgetCharts kind="months" rows={[...data.recentMonths].reverse().map((row) => ({ label: row.month, value: row.shopSpentCents }))} />
        <p className="hc-caption text-xs">Recorded supplier costs by credit date, or creation date for older orders. Total {money(data.shopSpentCents)}. {data.shop.processedWithActualCost} of {data.shop.processedOrders} processed orders have costs. These costs overlap HCB transactions; they are not added to cash expenses again.</p>
        {data.shop.missingActualCost > 0 && <Callout tone="warning" icon="info">{data.shop.missingActualCost} processed orders have no recorded supplier cost.</Callout>}
      </Card>

      <Card className="min-w-0">
        <CardHeader title="Reviewer earnings" icon="checkmark" count={data.reviewers.length} />
        <p className="mb-4 text-sm"><strong>{nominal(data.reviewerNetPx)}</strong> USD equivalent earned from reviewing ({px(data.reviewerNetPx)}). Already included in the reward economy above.</p>
        <Table headers={["Reviewer", "Review earnings (px)", "USD equivalent", "Paid reviews", "Pending reviews"]}>
          {data.reviewers.map((r) => <tr key={r.slackId || "unlinked"}>
            <td>{r.slackId ? <Link className="font-bold underline" href={`/reviewers/${encodeURIComponent(r.slackId)}`}>{(position.reviewerNames[r.slackId] || r.slackId).replace(/ \([^)]*\)$/, "")}</Link> : "Unlinked payout records"}</td>
            <td className="tabular-nums">{px(r.netWalletPx)}</td><td className="tabular-nums font-bold">{nominal(r.netWalletPx)}</td>
            <td>{r.paidReviews}</td><td>{r.pendingReviews}</td>
          </tr>)}
          {data.reviewers.length === 0 && <EmptyRow colSpan={5} title="No reviewer rewards yet" />}
        </Table>
        <p className="hc-caption mt-3 text-xs">Net transaction credits after cuts, voids and backfills. These are review earnings, not current wallet balances or cash wages. Approval: {data.reviewRates ? `${px(data.reviewRates.approved)} (${nominal(data.reviewRates.approved)})` : "Unavailable"}; needs changes: {data.reviewRates ? `${px(data.reviewRates.changes)} (${nominal(data.reviewRates.changes)})` : "Unavailable"}.</p>
      </Card>

      <details className="hc-card p-5">
        <summary className="cursor-pointer font-bold">Reconciliation details</summary>
        <div className="mt-4 space-y-3 text-sm hc-caption">
          <p>Wallet / transaction difference: {px(position.walletDriftPx)} across {position.walletDriftAccounts} accounts. Actual positive wallets are already reserved; do not deduct this difference again.</p>
          <p>Negative wallets: {px(position.negativeWalletsPx)}, shown separately rather than reducing other people's rewards.</p>
          <p>Review payouts, held Trial rewards and uncredited review records are reserved separately only until credited. Project reward reversals are not reviewer pay.</p>
        </div>
      </details>
    </div>
  );
}
