import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import { getBudgetData } from "@/lib/budget";
import { getProjectBudgetData } from "@/lib/budgetProjects";
import { getManualLedger, summarizeManualLedger } from "@/lib/budgetLedger";
import { addManualBudget, voidManualBudget } from "./actions";
import { nominalValueCents } from "@/lib/budgetMath";
import { config } from "@/app/_generated/config";
import { ActionButton, Badge, ButtonLink, Callout, Card, CardHeader, EmptyRow, Field, Flash, Input, NativeSelect, PageHeader, Stat, StatGrid, Table, Textarea } from "@/app/_ui/ui";

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

export default async function BudgetPage({ searchParams }: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePage("owner");
  if (await getLiveMode()) {
    return <LiveBlocked what="Budget" reason="This page contains private financial and reward information." />;
  }

  const [{ error, ok }, data, projects, ledger] = await Promise.all([
    searchParams, getBudgetData(), getProjectBudgetData(), getManualLedger(),
  ]);
  const manual = summarizeManualLedger(ledger);
  const partialCashBalanceCents = manual.settledIncomeCents - manual.settledExpenseCents - data.shopSpentCents;
  const openShopNominalCents = nominalValueCents(data.shop.openOrderPx, config.economy.pixelValueUsd);
  const today = new Date().toISOString().slice(0, 10);
  const rewardFaceValueCents = nominalValueCents(data.shop.redeemedPx, config.economy.pixelValueUsd);
  const nominalGap = rewardFaceValueCents - data.shopSpentCents;
  const largestMonth = Math.max(1, ...data.recentMonths.map((r) => r.shopSpentCents));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Budget" description="Real shop costs, owner-entered cash entries and projected PIXL reward obligations." actions={<ButtonLink href="#manual-ledger" icon="plus">Add custom entry</ButtonLink>} />
      <Flash error={error} ok={ok} />

      <Callout tone="info" icon="info">
        <strong>Cash and pixels are different.</strong> Recorded shop costs reflect the USD amounts entered by fulfillers.
        Pixels earned or redeemed are in-game rewards, not program revenue or cash paid to reviewers.
        Owner-entered income and expenses are self-reported, not independently verified.
        Review estimates and unfulfilled-order values are potential future reward costs, not money already spent.
        The $8.50/hour sponsor-side valuation is <strong>not received income</strong>.
        This remains a partial budget, not a bank balance or audited profit statement.
      </Callout>


      <Card>
        <CardHeader title="Cash & projected commitments" icon="bank" />
        <StatGrid>
          <Stat icon="bank" label="Manually recorded cash received" value={money(manual.settledIncomeCents)}
            hint="Owner-entered settled income, unverified" />
          <Stat icon="payment" label="Other cash expenses" value={money(manual.settledExpenseCents)}
            hint="Owner-entered settled expenses; do not duplicate shop orders" />
          <Stat icon="analytics" label="Partial recorded cash balance"
            value={manual.settledIncomeCents > 0 ? money(partialCashBalanceCents) : "Income not recorded"}
            hint="Recorded receipts − actual shop costs − settled manual expenses; not verified bank balance" />
          <Stat icon="list" label="Planned manual expenses" value={money(manual.plannedExpenseCents)}
            hint={`Planned income: ${money(manual.plannedIncomeCents)}; neither included in actual cash`} />
        </StatGrid>
        <div className="mt-4">
          <StatGrid>
            <Stat label="Review queue — nominal reward exposure" value={money(projects.estimatedRewardCents)}
              hint={`${projects.reviewProjectCount} projects; projected PIXL pixels at builder rates, not cash yet`} />
            <Stat label="Review queue — sponsor valuation" value={money(projects.sponsorValueCents)}
              hint={`${projects.pendingHours.toFixed(1)} incremental contributor-hours × ${config.economy.sponsorRateUsd.toFixed(2)}/h; not funding received`} />
            <Stat label="Unfulfilled shop order face value" value={money(openShopNominalCents)}
              hint={`${data.shop.openOrderCount} pending or ordered purchases; planned ceiling, not supplier invoices`} />
          </StatGrid>
        </div>
      </Card>

      <Card>
        <CardHeader title="Projects currently in review" icon="checkmark" count={projects.reviewProjectCount} />
        <p className="hc-caption mb-3 text-sm">
          The $8.50/h column values incremental eligible hours at the sponsor-side planning rate.
          The expected builder payout uses each player's current RE-based $4–$6/h rate,
          existing project credits, and accepted collaborators. Actual approval can change hours,
          tier, bonuses, trial selection or funding deductions. These are <strong>estimates, not invoices</strong>.
          Project updates show only new hours for the sponsor valuation.
        </p>
        {projects.trialContingentCount > 0 &&
          <Callout tone="warning" icon="info">
            {projects.trialContingentCount} submissions have a Trial reward choice that may hold or replace the owner's pixels.
            Their displayed reward estimate is conditional.
          </Callout>}
        <Table headers={["Project", "Status", "Owner hours", "Incremental hours", "Builder rate", "Sponsor value", "Est. additional reward"]}>
          {projects.pendingProjects.slice(0, 75).map((p) => (
            <tr key={p.id}>
              <td>
                <Link className="font-bold underline" href={`/review/${p.id}`}>{p.name}</Link>
                <div className="hc-caption text-xs">
                  Tier {p.tier} · {p.contributorCount} participant{p.contributorCount === 1 ? "" : "s"}
                  {p.heldForTrial ? " · Trial choice pending" : ""}
                </div>
              </td>
              <td><Badge tone={p.hasProposedBan ? "warning" : "neutral"}>{p.hasProposedBan ? "Ban proposed" : p.status.replaceAll("_", " ")}</Badge></td>
              <td className="tabular-nums">{p.hours.toFixed(1)}h</td>
              <td className="tabular-nums">{p.additionalHours.toFixed(1)}h</td>
              <td className="tabular-nums">{money(Math.round(p.estimatedRateUsd * 100))}/h</td>
              <td className="tabular-nums">{money(p.sponsorValueCents)}</td>
              <td className="font-bold tabular-nums">{money(p.estimatedPayoutCents)}</td>
            </tr>
          ))}
          {projects.pendingProjects.length === 0 && <EmptyRow colSpan={7} title="No projects awaiting review" icon="checkmark" />}
        </Table>
        {projects.pendingProjects.length > 75 && <p className="hc-caption mt-3 text-xs">Showing 75 most recently shipped; the totals above include all {projects.pendingProjects.length} projects.</p>}
      </Card>

      <Card>
        <CardHeader title="Actual historical project rewards" icon="analytics" />
        <p className="hc-caption mb-3 text-sm">
          From existing credited/reverted pixel transactions. Effective historical $/h is computed from
          net credited pixels and recorded credited hours at today's configured pixel value.
          It may differ from the original base rate due to bonuses, clawbacks, hardware deductions and rate changes.
          It does not mean PIXL paid out that much in cash.
        </p>
        <Table headers={["Project", "Participant", "Credited hours", "Net px credited", "Effective nominal $/h"]}>
          {projects.paidProjects.map((r, i) => (
            <tr key={`${r.projectId}:${r.slackId}:${i}`}>
              <td><Link href={`/review/${r.projectId}`} className="font-bold underline">{r.name}</Link></td>
              <td>{r.slackId || "Unlinked account"}</td>
              <td className="tabular-nums">{r.hours > 0 ? `${r.hours.toFixed(1)}h` : "Unknown"}</td>
              <td className="tabular-nums">{px(r.paidPx)}</td>
              <td className="tabular-nums">{r.effectiveUsdPerHour === null ? "Not available" : `${r.effectiveUsdPerHour.toFixed(2)}/h`}</td>
            </tr>
          ))}
          {projects.paidProjects.length === 0 && <EmptyRow colSpan={5} title="No credited project payouts yet" icon="bank" />}
        </Table>
        <p className="hc-caption mt-2 text-xs">Showing the 75 most recently credited project-participant records.</p>
      </Card>

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

      <Card>
        <div id="manual-ledger" className="scroll-mt-20">
          <CardHeader title="Custom income, expenses & future plans" icon="payment" />
        </div>
        <p className="hc-caption mb-4 text-sm">
          Record grant receipts, contractor payments, hosting, bounties, refunds or any other custom item,
          with your own label. Actual entries affect the partial cash view; planned entries do not.
          <strong> Do not enter a shop order's already-recorded supplier cost again.</strong>
          Entries are saved in the existing append-only audit log with the creating owner's Slack ID;
          voiding creates a correction event. Never include passwords, private addresses or sensitive personal data.
        </p>
        <form action={addManualBudget} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Type">
              <NativeSelect name="direction" defaultValue="expense" required>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </NativeSelect>
            </Field>
            <Field label="Status">
              <NativeSelect name="state" defaultValue="settled" required>
                <option value="settled">Actually paid / received</option>
                <option value="planned">Planned / pending</option>
              </NativeSelect>
            </Field>
            <Field label="Amount (USD)">
              <Input name="amountUsd" type="number" min="0.01" max="999999.99" step="0.01" required placeholder="0.00" />
            </Field>
            <Field label="Date">
              <Input name="occurredOn" type="date" defaultValue={today} required />
            </Field>
          </div>
          <Field label="Custom label">
            <Input name="label" minLength={3} maxLength={120} required placeholder="e.g. October hosting · security bounty · sponsor grant" />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="note" maxLength={500} rows={2} placeholder="What this item is for, without personal or private details" />
          </Field>
          <div><ActionButton icon="plus" pendingLabel="Saving...">Add budget item</ActionButton></div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Custom entries & correction history" icon="list" count={ledger.length} />
        <Table headers={["Date", "Label", "Category", "Amount", "Status", "Recorded by / correction"]}>
          {ledger.slice(0, 100).map((e) => (
            <tr key={e.id} className={e.voidedBy ? "opacity-60" : ""}>
              <td className="tabular-nums whitespace-nowrap">{e.occurredOn}</td>
              <td>
                <div className="font-bold">{e.label}</div>
                {e.note && <div className="hc-caption text-xs">{e.note}</div>}
              </td>
              <td>{e.direction === "expense" ? "Expense" : "Income"}</td>
              <td className="font-bold tabular-nums">{e.direction === "expense" ? "−" : "+"}{money(e.amountCents)}</td>
              <td><Badge tone={e.voidedBy ? "danger" : e.state === "settled" ? "success" : "warning"}>
                {e.voidedBy ? "Voided" : e.state === "settled" ? "Actual" : "Planned"}
              </Badge></td>
              <td>
                <div className="hc-caption text-xs">{e.createdBy}</div>
                {e.voidedBy ? (
                  <div className="hc-caption text-xs">Voided by {e.voidedBy}: {e.voidReason}</div>
                ) : (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs underline">Correct</summary>
                    <form action={voidManualBudget} className="mt-2 grid gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <Input name="reason" minLength={5} maxLength={300} required placeholder="Why is this entry incorrect?" />
                      <ActionButton variant="danger" size="sm" pendingLabel="Recording...">Void item</ActionButton>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
          {ledger.length === 0 && <EmptyRow colSpan={6} title="No custom entries yet" icon="bank" />}
        </Table>
        {ledger.length > 100 && <p className="hc-caption mt-2 text-xs">Showing the latest 100; all entries are included in the totals above.</p>}
      </Card>

    </div>
  );
}
