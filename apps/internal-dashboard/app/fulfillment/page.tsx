import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePage } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { LiveBlocked } from "@/app/_components/LiveBlocked";
import {
  listShopOrders,
  listFulfillers,
  buyerDetailsByUserId,
  buyerCountriesByUserId,
  fulfillerStatsBySlackId,
  shopEconomySummary,
  shopOrderStatusCounts,
  type ShopOrderRow,
  type BuyerDetails,
  type ShopEconomySummary,
} from "@/lib/db";
import { canOpenFulfillmentTab, canSeeBuyerDetails, isOwnOrder } from "@/lib/fulfillmentAccess";
import { evaluateOrders } from "@/lib/eligibility/evidence";
import type { EligibilityResult, EligibilityStatus } from "@/lib/eligibility/engine";
import {
  ELIGIBILITY_FILTERS,
  ELIGIBILITY_LABEL,
  SORT_KEYS,
  SORT_LABEL,
  VERIFICATION_FILTERS,
  VERIFICATION_LABEL,
  parseEligibilityFilter,
  parseSort,
  parseVerificationFilter,
  sortKeyValue,
  type SortKey,
} from "@/lib/eligibility/format";
import type { VerificationLabel } from "@/lib/eligibility/engine";
import { shipsProvider } from "@/lib/eligibility/ships";
import { ShipsSyncBar } from "./Funding";
import { addFulfillerAction, removeFulfillerAction } from "@/app/actions";
import { config } from "@/app/_generated/config";
import {
  ActionButton,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  CountBadge,
  Details,
  EmptyRow,
  EmptyState,
  Field,
  Input,
  Mono,
  PageHeader,
  Stat,
  StatGrid,
  Table,
  TextLink,
  buttonClass,
  formatDate,
} from "@/app/_ui/ui";
import { SlackHandle } from "./SlackHandle";
import { OrderList } from "./OrderList";
import { OrderDetail } from "./OrderDetail";

export const dynamic = "force-dynamic";

const TAB_KEYS = ["pending", "ordered", "credited", "shipped", "done", "cancelled", "flagged", "all", "leaderboard", "fulfillers"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// Keep the everyday fulfillment stages visible; uncommon stages live in Filters.
const PRIMARY_QUEUE_TABS: readonly TabKey[] = ["pending", "ordered", "shipped", "done", "all"];

// Lifetime shop P&L, fulfilled orders only. Both sides are scoped to the same
// cohort (orders with an actual_cost_usd on file, i.e. credited or later), so
// it compares fulfilled against fulfilled. New/Ordered orders aren't counted.
function ShopEconomy({ economy }: { economy: ShopEconomySummary }) {
  const redeemedUsd = economy.totalPx * config.economy.pixelValueUsd;
  const net = redeemedUsd - economy.totalActualCostUsd;
  const orders = economy.ordersWithCost > 0 ? `${economy.ordersWithCost} fulfilled orders` : "Fulfilled orders";
  return (
    <StatGrid>
      <Stat
        label="Redeemed by players"
        icon="enter"
        value={`${economy.totalPx.toLocaleString()} px`}
        hint={`$${redeemedUsd.toFixed(2)} · ${orders}`}
      />
      <Stat label="Spent fulfilling" icon="payment" value={`$${economy.totalActualCostUsd.toFixed(2)}`} />
      <Stat
        label="Net"
        icon="analytics"
        tone={net >= 0 ? "success" : "danger"}
        value={`${net >= 0 ? "+" : "-"}$${Math.abs(net).toFixed(2)}`}
      />
    </StatGrid>
  );
}

// Who's actually fulfilling orders, ranked by lifetime fulfillment pixels
// earned rather than order count, so a few expensive or slow orders don't look
// like less work than a pile of easy ones.
async function FulfillmentLeaderboard() {
  const stats = await fulfillerStatsBySlackId();
  const rows = [...stats.entries()].sort((a, b) => b[1].pixelsEarned - a[1].pixelsEarned);
  return (
    <Card padding="flush">
      <CardHeader title="Leaderboard" icon="leader" count={rows.length} />
      <Table headers={["Fulfiller", "Orders fulfilled", "Pixels earned", "Last active"]}>
        {rows.length === 0 && <EmptyRow colSpan={4} title="No fulfillments yet" icon="package" />}
        {rows.map(([slack, s]) => (
          <tr key={slack}>
            <td>
              <TextLink href={`/fulfillers/${slack}`} className="font-bold">
                <SlackHandle id={slack} fallback={`@${slack}`} />
              </TextLink>
            </td>
            <td className="tabular-nums">{s.shipped}</td>
            <td className="tabular-nums font-bold">{s.pixelsEarned.toLocaleString()} px</td>
            <td className="hc-muted">{formatDate(s.lastActivity)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

async function FulfillerManager() {
  const fulfillers = await listFulfillers();
  return (
    <Card padding="flush">
      <CardHeader title="Fulfillers" icon="person" count={fulfillers.length} />
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="hc-caption text-sm">
          Fulfillers (and owners) can claim orders and mark them credited or shipped. Marking an order done,
          reassigning it, and cancel &amp; refund stay owner-only.
        </p>
        <form action={addFulfillerAction} className="flex flex-wrap items-end gap-2">
          <Field label="Slack user ID" className="w-full max-w-60">
            <Input name="slackId" placeholder="U0..." className="font-mono" required />
          </Field>
          <ActionButton pendingLabel="Adding..." icon="member-add">
            Add fulfiller
          </ActionButton>
        </form>
      </div>
      <Table headers={["Fulfiller", "Slack ID", ""]}>
        {fulfillers.length === 0 && <EmptyRow colSpan={3} title="No fulfillers yet" icon="person" />}
        {fulfillers.map((f) => (
          <tr key={f.slack_user_id}>
            <td>
              <TextLink href={`/fulfillers/${f.slack_user_id}`} className="font-bold">
                <SlackHandle id={f.slack_user_id} fallback={`@${f.slack_user_id}`} />
              </TextLink>
            </td>
            <td>
              <Mono>{f.slack_user_id}</Mono>
            </td>
            <td className="text-right">
              <form action={removeFulfillerAction}>
                <input type="hidden" name="slackId" value={f.slack_user_id} />
                <ActionButton variant="danger" size="sm" pendingLabel="Removing...">
                  Remove
                </ActionButton>
              </form>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string; q?: string; order?: string; elig?: string; verify?: string; sort?: string }>;
}) {
  const access = await requirePage("fulfiller");
  if (await getLiveMode()) return <LiveBlocked what="Fulfillment" />;
  const me = access.session.slackId;
  const { status, mine, q, order: orderParam, elig, verify, sort } = await searchParams;
  const eligFilter = parseEligibilityFilter(elig);
  const verifyFilter = parseVerificationFilter(verify);
  const sortKey = parseSort(sort);
  const active: TabKey = TAB_KEYS.includes(status as TabKey) ? (status as TabKey) : "pending";
  if (!canOpenFulfillmentTab(active, access)) redirect("/fulfillment");
  const keepMine = mine === "1";
  const query = (q ?? "").trim().slice(0, 100);
  const showingFulfillers = active === "fulfillers";
  const showingLeaderboard = active === "leaderboard";
  const showingQueue = !showingFulfillers && !showingLeaderboard;
  const mineOnly = keepMine && showingQueue;

  // "My queue" is a fixed cross-stage view, not a filter on the selected tab:
  // every order this fulfiller has claimed that isn't done yet. Filtering the
  // default New tab instead would always be empty, since nobody has claimed a
  // pending order yet.
  let loaded: ShopOrderRow[];
  if (!showingQueue) {
    loaded = [];
  } else if (mineOnly) {
    const [orderedRows, creditedRows, shippedRows] = await Promise.all([
      listShopOrders("ordered", 500),
      listShopOrders("credited", 500),
      listShopOrders("shipped", 500),
    ]);
    loaded = [...orderedRows, ...creditedRows, ...shippedRows]
      .filter((o) => o.claimed_by_slack === me)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else {
    loaded = await listShopOrders(active === "all" ? undefined : active, 500);
  }

  const nameFor = (o: ShopOrderRow) => (canSeeBuyerDetails(o, access) ? o.player_name : o.player_display_name);
  let eligibility = new Map<number, EligibilityResult>();
  const shipsView = showingQueue ? await shipsProvider().get() : null;
  if (showingQueue && loaded.length > 0) {
    try {
      eligibility = await evaluateOrders(loaded, { liveAirtable: true, ships: shipsView ?? undefined });
    } catch (e) {
      console.error("fulfillment eligibility", (e as Error).message);
    }
  }
  const needle = query.toLowerCase();
  const searchable = (o: ShopOrderRow): string[] => {
    const r = eligibility.get(Number(o.id));
    const project = (r?.projects ?? []).flatMap((p) => [p.name, p.repoKey ?? "", p.ships?.githubUsername ?? ""]);
    return [o.item_name, o.option, nameFor(o), o.player_slack ?? "", ...project];
  };
  const searched = needle ? loaded.filter((o) => searchable(o).some((v) => v.toLowerCase().includes(needle))) : loaded;
  const filtered = searched
    .filter((o) => !eligFilter || (eligibility.get(Number(o.id))?.status ?? "unverified") === eligFilter)
    .filter((o) => !verifyFilter || eligibility.get(Number(o.id))?.verification === verifyFilter);
  const orders =
    sortKey === "newest"
      ? filtered
      : [...filtered].sort(
          (a, b) =>
            sortKeyValue(eligibility.get(Number(b.id)), sortKey) - sortKeyValue(eligibility.get(Number(a.id)), sortKey),
        );

  const requestedId = Number(orderParam);
  const selected = orders.find((o) => Number(o.id) === requestedId) ?? orders[0] ?? null;
  const explicitSelection = selected !== null && Number(selected.id) === requestedId;

  if (selected) {
    try {
      const fresh = await evaluateOrders([selected], { liveAirtable: true, ships: shipsView ?? undefined });
      for (const [id, r] of fresh) eligibility.set(id, r);
    } catch (e) {
      console.error("fulfillment eligibility (selected)", (e as Error).message);
    }
  }

  const counts = showingQueue ? await shopOrderStatusCounts() : null;

  // Buyer PII is decrypted only for the selected order, gated by canSeeBuyerDetails.
  const selectedCanSee = selected ? canSeeBuyerDetails(selected, access) : false;
  const [buyerDetails, buyerCountries] = await Promise.all([
    selected && selectedCanSee ? buyerDetailsByUserId([selected.user_id]) : Promise.resolve(new Map<string, BuyerDetails>()),
    selected && !selectedCanSee ? buyerCountriesByUserId([selected.user_id]) : Promise.resolve(new Map<string, string>()),
  ]);
  // Owner-only: a financial rollup, not something a fulfiller needs to do the job.
  const economy = access.isOwner ? await shopEconomySummary() : null;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "pending", label: "New", count: counts?.pending },
    { key: "ordered", label: "Ordered", count: counts?.ordered },
    { key: "credited", label: "Credited", count: counts?.credited },
    { key: "shipped", label: "Shipped", count: counts?.shipped },
    { key: "done", label: "Done", count: counts?.done },
    { key: "cancelled", label: "Cancelled", count: counts?.cancelled },
    { key: "flagged", label: "Over budget", count: counts?.flagged },
    { key: "all", label: "All", count: counts?.all },
  ];

  const hrefFor = (next: {
    status?: TabKey;
    mine?: boolean;
    q?: string;
    order?: number;
    elig?: EligibilityStatus | null;
    verify?: VerificationLabel | null;
    sort?: SortKey;
  }) => {
    const params = new URLSearchParams();
    const st = next.status ?? active;
    if (st !== "pending") params.set("status", st);
    if (next.mine ?? keepMine) params.set("mine", "1");
    const qv = next.q ?? query;
    if (qv) params.set("q", qv);
    const ev = next.elig === undefined ? eligFilter : next.elig;
    if (ev) params.set("elig", ev);
    const vv = next.verify === undefined ? verifyFilter : next.verify;
    if (vv) params.set("verify", vv);
    const sv = next.sort ?? sortKey;
    if (sv !== "newest") params.set("sort", sv);
    if (next.order !== undefined) params.set("order", String(next.order));
    const qs = params.toString();
    return qs ? `/fulfillment?${qs}` : "/fulfillment";
  };

  const emptyTitle = query
    ? `No requests match "${query}"`
    : verifyFilter
      ? `No "${VERIFICATION_LABEL[verifyFilter].toLowerCase()}" orders in this view`
    : eligFilter
      ? `No ${ELIGIBILITY_LABEL[eligFilter].toLowerCase()} orders in this view`
      : mineOnly
      ? "Nothing in your queue"
      : active === "pending"
        ? "No orders waiting to be claimed"
        : active === "flagged"
          ? "Nothing over budget right now"
          : "Nothing here yet";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={mineOnly ? "My queue" : "Fulfillment"}
        description="Process player requests, place orders, and keep everything moving. Claim one to place the real order; tracking is DM'd to the buyer when it ships, and an order can be cancelled for a refund until someone claims it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {showingQueue ? (
              <ButtonLink href={hrefFor({ mine: !mineOnly })} variant={mineOnly ? "primary" : "outline"} size="sm" icon="list">
                {mineOnly ? "Back to all orders" : "My queue"}
              </ButtonLink>
            ) : (
              <ButtonLink href={hrefFor({ status: "pending" })} variant="primary" size="sm" icon="list">
                Back to requests
              </ButtonLink>
            )}
            {!showingLeaderboard && (
              <ButtonLink href={hrefFor({ status: "leaderboard" })} variant="outline" size="sm" icon="leader">
                Leaderboard
              </ButtonLink>
            )}
            {access.isOwner && !showingFulfillers && (
              <ButtonLink href={hrefFor({ status: "fulfillers" })} variant="outline" size="sm" icon="person">
                Fulfillers
              </ButtonLink>
            )}
          </div>
        }
      />

      <Callout tone="info" icon="payment">
        Every order shows a <strong>budget</strong>: what the player&apos;s pixels are worth at $
        {config.economy.pixelValueUsd.toFixed(2)} per pixel. Buy it for that or less. If the cheapest you can find is
        over budget, don&apos;t place the order: flag it with what you found and an owner picks it up from the Over
        budget tab.
      </Callout>

      {economy && (
        <Details summary="Shop economy">
          <ShopEconomy economy={economy} />
        </Details>
      )}

      {shipsView && <ShipsSyncBar view={shipsView} />}

      {showingFulfillers ? (
        <FulfillerManager />
      ) : showingLeaderboard ? (
        <FulfillmentLeaderboard />
      ) : (
        <div className="fw-grid" data-explicit={explicitSelection ? "true" : undefined}>
          <section className="fw-list" aria-label="Requests">
            <div className="fw-list-head">
              <h2 className="hc-heading text-lg">
                Requests <span className="hc-muted">({orders.length})</span>
              </h2>
              <form action="/fulfillment" method="get" role="search" className="fw-search">
                {active !== "pending" && <input type="hidden" name="status" value={active} />}
                {mineOnly && <input type="hidden" name="mine" value="1" />}
                {eligFilter && <input type="hidden" name="elig" value={eligFilter} />}
                {verifyFilter && <input type="hidden" name="verify" value={verifyFilter} />}
                {sortKey !== "newest" && <input type="hidden" name="sort" value={sortKey} />}
                <Input name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search players, GitHub, projects, items..." aria-label="Search requests" />
                <button type="submit" className={buttonClass("outline")}>
                  Search
                </button>
              </form>
            </div>
            {!mineOnly && (
              <nav className="fw-chips fw-stage-tabs" aria-label="Order stage">
                {tabs.filter((t) => PRIMARY_QUEUE_TABS.includes(t.key)).map((t) => (
                  <Link
                    key={t.key}
                    href={hrefFor({ status: t.key, order: undefined })}
                    className="fw-chip"
                    aria-current={t.key === active ? "page" : undefined}
                  >
                    {t.label}
                    {t.count !== undefined && <CountBadge>{t.count}</CountBadge>}
                  </Link>
                ))}
                {!PRIMARY_QUEUE_TABS.includes(active) && tabs.filter((t) => t.key === active).map((t) => (
                  <Link
                    key={t.key}
                    href={hrefFor({ status: t.key, order: undefined })}
                    className="fw-chip"
                    aria-current="page"
                  >
                    {t.label}
                    {t.count !== undefined && <CountBadge>{t.count}</CountBadge>}
                  </Link>
                ))}
              </nav>
            )}
            {showingQueue && (
              <div className="fw-filters-shell">
                <details className="fw-filters" open={Boolean(eligFilter || verifyFilter || sortKey !== "newest")}>
                  <summary className="fw-filter-toggle">
                    <span>Filters &amp; sort</span>
                    {(Number(Boolean(eligFilter)) + Number(Boolean(verifyFilter)) + Number(sortKey !== "newest")) > 0 && (
                      <span className="fw-filter-count">
                        {Number(Boolean(eligFilter)) + Number(Boolean(verifyFilter)) + Number(sortKey !== "newest")} active
                      </span>
                    )}
                  </summary>
                  <div className="fw-filter-body">
                    {!mineOnly && (
                      <div className="fw-filter-group">
                        <div className="fw-filter-group-title">
                          <strong>Other stages</strong>
                          <span>Less commonly used order queues</span>
                        </div>
                        <nav className="fw-chips" aria-label="Other order stages">
                          {tabs.filter((t) => !PRIMARY_QUEUE_TABS.includes(t.key)).map((t) => (
                            <Link
                              key={t.key}
                              href={hrefFor({ status: t.key, order: undefined })}
                              className="fw-chip"
                              aria-current={t.key === active ? "page" : undefined}
                            >
                              {t.label}
                              {t.count !== undefined && <CountBadge>{t.count}</CountBadge>}
                            </Link>
                          ))}
                        </nav>
                      </div>
                    )}
                    <div className="fw-filter-group">
                      <div className="fw-filter-group-title">
                        <strong>Funding</strong>
                        <span>Does the player have enough verified budget?</span>
                      </div>
                      <nav className="fw-chips" aria-label="Filter by funding">
                        <Link href={hrefFor({ elig: null, order: undefined })} className="fw-chip" aria-current={eligFilter ? undefined : "page"}>
                          All
                        </Link>
                        {ELIGIBILITY_FILTERS.map((f) => (
                          <Link
                            key={f}
                            href={hrefFor({ elig: f, order: undefined })}
                            className="fw-chip"
                            aria-current={f === eligFilter ? "page" : undefined}
                          >
                            {ELIGIBILITY_LABEL[f]}
                          </Link>
                        ))}
                      </nav>
                    </div>
                    <div className="fw-filter-group">
                      <div className="fw-filter-group-title">
                        <strong>Ships verification</strong>
                        <span>Is the player's project approval confirmed?</span>
                      </div>
                      <nav className="fw-chips" aria-label="Filter by verification">
                        <Link href={hrefFor({ verify: null, order: undefined })} className="fw-chip" aria-current={verifyFilter ? undefined : "page"}>
                          All
                        </Link>
                        {VERIFICATION_FILTERS.map((f) => (
                          <Link
                            key={f}
                            href={hrefFor({ verify: f, order: undefined })}
                            className="fw-chip"
                            aria-current={f === verifyFilter ? "page" : undefined}
                          >
                            {VERIFICATION_LABEL[f]}
                          </Link>
                        ))}
                      </nav>
                    </div>
                    <div className="fw-filter-group">
                      <div className="fw-filter-group-title">
                        <strong>Sort requests</strong>
                        <span>Choose which requests appear first</span>
                      </div>
                      <nav className="fw-chips" aria-label="Sort">
                        {SORT_KEYS.map((k) => (
                          <Link
                            key={k}
                            href={hrefFor({ sort: k, order: undefined })}
                            className="fw-chip"
                            aria-current={k === sortKey ? "page" : undefined}
                          >
                            {SORT_LABEL[k]}
                          </Link>
                        ))}
                      </nav>
                    </div>
                    {(eligFilter || verifyFilter || sortKey !== "newest") && (
                      <Link className="fw-filter-reset" href={hrefFor({ elig: null, verify: null, sort: "newest", order: undefined })}>
                        Clear extra filters
                      </Link>
                    )}
                  </div>
                </details>
                {(eligFilter || verifyFilter || sortKey !== "newest") && (
                  <div className="fw-filter-active" aria-label="Applied filters">
                    <span className="fw-filter-active-label">Showing:</span>
                    {eligFilter && <span>Funding: {ELIGIBILITY_LABEL[eligFilter]}</span>}
                    {verifyFilter && <span>Ships: {VERIFICATION_LABEL[verifyFilter]}</span>}
                    {sortKey !== "newest" && <span>Sort: {SORT_LABEL[sortKey]}</span>}
                    <Link href={hrefFor({ elig: null, verify: null, sort: "newest", order: undefined })}>Clear</Link>
                  </div>
                )}
              </div>
            )}
            {orders.length === 0 ? (
              <EmptyState title={emptyTitle} icon="package" />
            ) : (
              <OrderList
                orders={orders}
                selectedId={selected?.id ?? null}
                hrefFor={(id) => hrefFor({ order: id })}
                nameFor={nameFor}
                now={Date.now()}
                eligibility={eligibility}
              />
            )}
          </section>
          <section className="fw-pane" aria-label="Selected request">
            {selected ? (
              <OrderDetail
                key={selected.id}
                order={selected}
                buyer={selectedCanSee ? buyerDetails.get(selected.user_id) : undefined}
                country={selectedCanSee ? undefined : (buyerCountries.get(selected.user_id) ?? "")}
                requesterName={nameFor(selected)}
                ownOrder={isOwnOrder(selected, me)}
                mine={selected.claimed_by_slack === me}
                canManage={access.isOwner}
                eligibility={eligibility.get(Number(selected.id)) ?? null}
              />
            ) : (
              <EmptyState title="No request selected" icon="package" />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
