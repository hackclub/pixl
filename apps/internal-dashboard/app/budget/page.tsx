import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { getBudgetData } from "@/lib/budget";
import { nominalValueCents } from "@/lib/budgetMath";
import { config } from "@/app/_generated/config";
import { Badge, Callout, Card, CardHeader, EmptyRow, PageHeader, Stat, StatGrid, Table } from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  const absolute = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return `${cents < 0 ? "−" : ""}$${absolute}`;
}
const px = (value: number) => `${value.toLocaleString("en-US")} px`;
const nominal = (value: number) => money(nominalValueCents(value, config.economy.pixelValueUsd));
const monthLabel = (value: string) =>
  new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", year: "numeric", timeZone: "UTC",
  });

export default async function BudgetPage() {
  await requirePage("owner");
  if (await getLiveMode()) {
    return <LiveBlocked what="Budget" reason="This page contains private financial and reward information." />;
  }

  const data = await getBudgetData();
  const rewardFaceValueCents = nominalValueCents(data.shop.redeemedPx, config.economy.pixelValueUsd);
  const nominalGap = rewardFaceValueCents - data.shopSpentCents;
  const largestMonth = Math.max(1, ...data.recentMonths.map((r) => r.shopSpentCents));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Budget" description="PIXL shop spending and reward economy, reported from existing records. Owner-only, read-only." />

      <Callout tone="info" icon="info">
        <strong>Cash and pixels are different.</strong> Recorded shop costs reflect the USD amounts entered by fulfillers.
        Pixels earned or redeemed are in-game rewards, not program revenue or cash paid to reviewers.
        This report does not include external funding, donations, contractor invoices, bounties, hosting or other off-platform expenses.
        It is not a complete budget, bank balance or profit statement.
      </Callout>

      <StatGrid>
        <Stat icon="payment" label="Recorded shop spending" value={money(data.shopSpentCents)}
          hint="Non-cancelled orders with actual supplier costs recorded" />
        <Stat icon="package" label="Costed shop orders" value={data.shop.ordersWithActualCost.toLocaleString("en-US")}
          hint="Non-cancelled orders with actual_cost_usd" />
        <Stat icon="checkmark" label="Processed-order cost coverage"
          value={data.shop.coveragePercent === null ? "No orders" : `${data.shop.coveragePercent}%`}
          hint={`${data.shop.processedWithActualCost} of ${data.shop.processedOrders} credited, shipped or done orders have costs`}
          tone={data.shop.missingActualCost > 0 ? "warning" : "neutral"} />
        <Stat icon="bank" label="Pixels redeemed on costed orders" value={px(data.shop.redeemedPx)}
          hint="Same order group as recorded shop spending" />
      </StatGrid>

      {data.shop.missingActualCost > 0 && (
        <Callout tone="warning" icon="info">
          <strong>${data.shop.missingActualCost} processed orders are missing actual costs.</strong>
          Reported shop spending is incomplete until fulfillers backfill those orders.
          Never substitute the pixel-derived USD ceiling for a real supplier receipt.
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Shop cost compared with reward value" icon="analytics" />
          <p className="hc-caption mb-4 text-sm">
            This comparison uses only orders with actual USD costs recorded. The dollar value of pixels is a nominal
            conversion, not a payment PIXL received.
          </p>
          <StatGrid>
            <Stat label="Nominal value of redeemed pixels" value={money(rewardFaceValueCents)}
              hint="Pixels redeemed × configured USD value" />
            <Stat label="Actual supplier cost recorded" value={money(data.shopSpentCents)}
              hint="USD entered during fulfillment" />
            <Stat label="Difference (illustrative only)" value={money(nominalGap)}
              hint="Not cash income, operating margin or profit" />
          </StatGrid>
        </Card>
        <Card>
          <CardHeader title="Shop spending by month" icon="list" />
          <p className="hc-caption mb-3 text-sm">Last 12 months with recorded costs, grouped by credited date (or creation date for older orders).</p>
          <Table headers={["Month", "Cost", "Orders", "Relative cost"]}>
            {data.recentMonths.map((r) => (
              <tr key={r.month}>
                <td className="whitespace-nowrap font-bold">{monthLabel(r.month)}</td>
                <td className="tabular-nums whitespace-nowrap">{money(r.shopSpentCents)}</td>
                <td className="tabular-nums">{r.orders}</td>
                <td className="w-1/3">
                  <div className="h-2 min-w-12 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div className="h-full rounded-full bg-neutral-700 dark:bg-neutral-300"
                      style={{ width: `${Math.max(2, Math.round(r.shopSpentCents / largestMonth * 100))}%` }} />
                  </div>
                </td>
              </tr>
            ))}
            {data.recentMonths.length === 0 && <EmptyRow colSpan={4} title="No shop costs recorded" icon="payment" />}
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader title="Project & fulfillment rewards" icon="bank" />
        <p className="hc-caption mb-3 text-sm">These are in-game pixel transactions, not cash expenses.</p>
        <StatGrid>
          <Stat label="Project rewards, net" value={px(data.projectPayoutPx)}
            hint={`Nominal value ${nominal(data.projectPayoutPx)}; includes review reversals`} />
          <Stat label="Operation adjustments, net" value={px(data.operationAdjustmentPx)}
            hint="Operation Blackout credits and reversals" />
          <Stat label="Fulfiller rewards, net" value={px(data.fulfillerNetPx)}
            hint={`Nominal value ${nominal(data.fulfillerNetPx)}`} />
          <Stat label="Reviewer wallet rewards, net" value={px(data.reviewerNetPx)}
            hint={`Nominal value ${nominal(data.reviewerNetPx)}; after corrections and backfills`} />
        </StatGrid>
      </Card>

      <Card>
        <CardHeader title="Reviewer payouts" icon="checkmark" count={data.reviewers.length} />
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge>Paid payout records: {data.reviewerPaidCount.toLocaleString("en-US")}</Badge>
          <Badge>Pending payout records: {data.reviewerPendingCount.toLocaleString("en-US")}</Badge>
          <Badge>Configured approval rate: {data.reviewRates ? px(data.reviewRates.approved) : "Unavailable"}</Badge>
          <Badge>Needs changes: {data.reviewRates ? px(data.reviewRates.changes) : "Unavailable"}</Badge>
        </div>
        <p className="hc-caption mb-3 text-sm">
          Credited px comes from payout records. Net wallet px comes from transactions and includes cuts, voids and backfills.
          The two can differ. Unlinked payout rows are listed without a reviewer profile link.
        </p>
        <Table headers={["Reviewer", "Paid", "Pending", "Credited px", "Net wallet px", "Nominal value"]}>
          {data.reviewers.map((r) => (
            <tr key={r.slackId || "unlinked"}>
              <td>
                {r.slackId
                  ? <Link className="font-bold underline" href={`/reviewers/${encodeURIComponent(r.slackId)}`}>{r.slackId}</Link>
                  : <span className="hc-muted">Unlinked payout records</span>}
              </td>
              <td className="tabular-nums">{r.paidReviews}</td>
              <td className="tabular-nums">{r.pendingReviews}</td>
              <td className="tabular-nums">{px(r.creditedPx)}</td>
              <td className="font-bold tabular-nums">{px(r.netWalletPx)}</td>
              <td className="tabular-nums">{nominal(r.netWalletPx)}</td>
            </tr>
          ))}
          {data.reviewers.length === 0 && <EmptyRow colSpan={6} title="No reviewer payout records yet" icon="checkmark" />}
        </Table>
      </Card>
    </div>
  );
}
