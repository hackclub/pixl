import Link from "next/link";
import { requireFulfiller } from "@/lib/guard";
import {
  listShopOrders,
  listFulfillers,
  buyerDetailsByUserId,
  fulfillerStatsBySlackId,
  ORDER_STAGES,
  type ShopOrderRow,
  type OrderStatus,
  type BuyerDetails,
} from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import {
  claimOrder,
  markOrderCredited,
  shipOrder,
  markOrderDone,
  reassignOrder,
  cancelOrder,
  addFulfillerAction,
  removeFulfillerAction,
  flagOrderOverBudget,
  clearOrderFlag,
  updateOrderFulfillmentInfo,
} from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";
import { Disclosure } from "@/app/_components/Disclosure";
import { isSafeUrl } from "@/lib/safeUrl";
import { config } from "@/app/_generated/config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<OrderStatus, "secondary" | "success" | "destructive" | "warning"> = {
  pending: "secondary",
  ordered: "warning",
  credited: "warning",
  shipped: "success",
  done: "success",
  cancelled: "destructive",
};

// Human labels for each stage.
const STAGE_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  ordered: "Ordered",
  credited: "Credited",
  shipped: "Shipped",
  done: "Done",
  cancelled: "Cancelled",
};

function slackLink(id: string): string {
  return `https://slack.com/app_redirect?channel=${id}`;
}

// What the order's pixels are actually worth in dollars, i.e. the ceiling a
// fulfiller has to source the item under. Mirrors the px figure 1:1 so the two
// badges always describe the same amount.
function usdBudget(pricePx: number): string {
  return (pricePx * config.economy.pixelValueUsd).toFixed(2);
}

const TAB_KEYS = ["pending", "ordered", "credited", "shipped", "done", "cancelled", "flagged", "all", "leaderboard", "fulfillers"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// Who's actually fulfilling orders - ranked by lifetime fulfillment pixels
// earned (3px per order shipped, see FULFILLMENT_PAYOUT_PIXELS in
// app/actions.ts), not just order count, so a handful of expensive/slow
// orders don't look like less work than a pile of easy ones.
async function FulfillmentLeaderboard() {
  const stats = await fulfillerStatsBySlackId();
  const rows = [...stats.entries()].sort((a, b) => b[1].pixelsEarned - a[1].pixelsEarned);
  const handles = await slackHandles(rows.map(([slack]) => slack));
  return (
    <Card className="overflow-hidden py-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground text-left border-b border-border">
            <th className="p-3 font-medium">Fulfiller</th>
            <th className="p-3 font-medium">Orders fulfilled</th>
            <th className="p-3 font-medium">Pixels earned</th>
            <th className="p-3 font-medium">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="p-5 text-center text-muted-foreground">
                No fulfillments yet.
              </td>
            </tr>
          )}
          {rows.map(([slack, s]) => (
            <tr key={slack}>
              <td className="p-3 font-medium">
                <Link href={`/fulfillers/${slack}`} className="hover:text-brand">
                  {handles.get(slack) ?? `@${slack}`}
                </Link>
              </td>
              <td className="p-3 tabular-nums">{s.shipped}</td>
              <td className="p-3 tabular-nums font-medium">{s.pixelsEarned.toLocaleString()} px</td>
              <td className="p-3 text-muted-foreground">{fmtDate(s.lastActivity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function FulfillerManager() {
  const fulfillers = await listFulfillers();
  const handles = await slackHandles(fulfillers.map((f) => f.slack_user_id));
  return (
    <Card className="p-5 mb-6">
      <div className="text-sm font-semibold mb-1">Fulfillers</div>
      <p className="text-xs text-muted-foreground mb-3">
        Fulfillers (and owners) can claim orders and mark them credited/shipped. Marking an order
        done, reassigning it, and cancel &amp; refund stay owner-only.
      </p>
      <form action={addFulfillerAction} className="flex flex-wrap gap-2 mb-3">
        <Input
          name="slackId"
          placeholder="Slack user ID (U0…)"
          className="max-w-56 text-sm font-mono"
          required
        />
        <PendingButton pendingText="Adding…">Add fulfiller</PendingButton>
      </form>
      {fulfillers.length === 0 ? (
        <div className="text-xs text-muted-foreground">No fulfillers yet.</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {fulfillers.map((f) => (
            <li
              key={f.slack_user_id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-sm"
            >
              <Link href={`/fulfillers/${f.slack_user_id}`} className="font-medium hover:text-brand">
                {handles.get(f.slack_user_id) ?? `@${f.slack_user_id}`}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">{f.slack_user_id}</span>
              <form action={removeFulfillerAction}>
                <input type="hidden" name="slackId" value={f.slack_user_id} />
                <button
                  type="submit"
                  className="text-xs text-destructive hover:underline"
                  title="Remove fulfiller"
                >
                  remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mine?: string }>;
}) {
  const access = await requireFulfiller();
  const me = access.session.slackId;
  const { status, mine } = await searchParams;
  const active: TabKey = TAB_KEYS.includes(status as TabKey) ? (status as TabKey) : "pending";
  const mineOnly = mine === "1";
  const showingFulfillers = active === "fulfillers";
  const showingLeaderboard = active === "leaderboard";

  let orders =
    showingFulfillers || showingLeaderboard
      ? []
      : await listShopOrders(active === "all" ? undefined : active, 500);
  if (mineOnly) orders = orders.filter((o) => o.claimed_by_slack === me);
  const pendingCount =
    active === "pending" && !mineOnly
      ? orders.length
      : (await listShopOrders("pending", 1)).length;
  const flaggedCount =
    active === "flagged" && !mineOnly ? orders.length : (await listShopOrders("flagged", 50)).length;
  const handles = await slackHandles(orders.map((o) => o.player_slack));
  // Name/email/mailing address so a fulfiller can actually source and ship
  // the right thing without leaving the page - see the "Shipping info"
  // disclosure on each card.
  const buyerDetails = await buyerDetailsByUserId(orders.map((o) => o.user_id));

  const tabs: { key: TabKey; label: string }[] = [
    { key: "pending", label: "New" },
    { key: "ordered", label: "Ordered" },
    { key: "credited", label: "Credited" },
    { key: "shipped", label: "Shipped" },
    { key: "done", label: "Done" },
    { key: "cancelled", label: "Cancelled" },
    { key: "flagged", label: `Over budget${flaggedCount > 0 ? ` (${flaggedCount})` : ""}` },
    { key: "all", label: "All" },
    { key: "leaderboard", label: "Leaderboard" },
    ...(access.isSuper ? [{ key: "fulfillers" as TabKey, label: "Fulfillers" }] : []),
  ];

  const linkFor = (key: TabKey) => {
    const params = new URLSearchParams();
    if (key !== "pending") params.set("status", key);
    if (mineOnly && key !== "fulfillers" && key !== "leaderboard") params.set("mine", "1");
    const qs = params.toString();
    return qs ? `/fulfillment?${qs}` : "/fulfillment";
  };
  const mineToggleLink = () => {
    const params = new URLSearchParams();
    if (active !== "pending") params.set("status", active);
    if (!mineOnly) params.set("mine", "1");
    const qs = params.toString();
    return qs ? `/fulfillment?${qs}` : "/fulfillment";
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">Fulfillment</h1>
      <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
        Orders players placed in the shop with pixels. Claim one to place the real order , it moves
        into your queue and walks through <em>ordered → credited → shipped</em>. Enter tracking when
        it ships and Pixo DMs it to the buyer. Cancel any time before it ships to refund the pixels.
      </p>
      <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
        Every order shows a <span className="text-foreground font-medium">budget</span>, what the
        player&apos;s pixels are worth at ${config.economy.pixelValueUsd.toFixed(2)} per pixel. Buy
        it for that or less. If the cheapest you can find is over budget, don&apos;t place the order:
        flag it with what you found and an owner picks it up from the Over budget tab.
      </p>

      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="inline-flex items-center rounded-lg border border-border p-0.5 bg-card">
          {tabs.map((t) => (
            <Button
              key={t.key}
              asChild
              variant="ghost"
              size="sm"
              className={active === t.key ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : ""}
            >
              <Link href={linkFor(t.key)}>
                {t.label}
                {t.key === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
              </Link>
            </Button>
          ))}
        </div>
        {!showingFulfillers && !showingLeaderboard && (
          <Button
            asChild
            variant={mineOnly ? "default" : "outline"}
            size="sm"
            className={mineOnly ? "bg-brand text-white hover:bg-brand/90 hover:text-white border-transparent" : ""}
          >
            <Link href={mineToggleLink()}>{mineOnly ? "My queue ✓" : "My queue"}</Link>
          </Button>
        )}
      </div>

      {showingFulfillers ? (
        <FulfillerManager />
      ) : showingLeaderboard ? (
        <FulfillmentLeaderboard />
      ) : orders.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          {active === "pending"
            ? "No orders waiting to be claimed. Nice and clear."
            : active === "flagged"
              ? "Nothing over budget right now."
              : mineOnly
              ? "Nothing in your queue here."
              : "Nothing here yet."}
        </Card>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => (
            <OrderCard
              key={o.id}
              order={o}
              handle={o.player_slack ? handles.get(o.player_slack) : undefined}
              buyer={buyerDetails.get(o.user_id)}
              mine={o.claimed_by_slack === me}
              canManage={access.perms.has("fulfillment")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// The four live stages as a stepper, current one lit. Cancelled orders skip it.
function StageSteps({ status }: { status: OrderStatus }) {
  if (status === "cancelled") return null;
  const idx = ORDER_STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {ORDER_STAGES.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span
            className={
              i < idx
                ? "text-muted-foreground"
                : i === idx
                  ? "font-semibold text-brand"
                  : "text-muted-foreground/40"
            }
          >
            {STAGE_LABEL[s]}
          </span>
          {i < ORDER_STAGES.length - 1 && <span className="text-muted-foreground/30">→</span>}
        </span>
      ))}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

function OrderCard({
  order: o,
  handle,
  buyer,
  mine,
  canManage,
}: {
  order: ShopOrderRow;
  handle?: string;
  buyer?: BuyerDetails;
  mine: boolean;
  canManage: boolean;
}) {
  // Terminal orders are read-only; everything else still has an action.
  const actionable = o.status !== "done" && o.status !== "cancelled";
  return (
    <Card className="p-4 gap-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">
              {o.quantity > 1 ? `${o.quantity}× ` : ""}
              {o.item_name || "(item removed)"}
            </span>
            <Badge variant="success" className="tabular-nums">
              {o.price} px
            </Badge>
            <Badge
              variant="secondary"
              className="tabular-nums"
              title={`${o.price} px x $${config.economy.pixelValueUsd.toFixed(2)}. Source it at or under this, otherwise flag it instead of ordering.`}
            >
              ${usdBudget(o.price)} budget
            </Badge>
            {o.actual_cost_usd !== null && (
              <Badge
                variant={Number(o.actual_cost_usd) > Number(usdBudget(o.price)) ? "destructive" : "success"}
                className="tabular-nums"
                title="What this order actually cost, recorded by the fulfiller who claimed it"
              >
                ${Number(o.actual_cost_usd).toFixed(2)} actual
              </Badge>
            )}
            <Badge variant={STATUS_BADGE[o.status] ?? "secondary"} className="capitalize">
              {STAGE_LABEL[o.status] ?? o.status}
            </Badge>
            {o.option && <Badge variant="secondary">{o.option}</Badge>}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            <Link href={`/players/${o.user_id}`} className="font-medium text-foreground hover:text-brand">
              {o.player_name}
            </Link>
            {o.player_slack && (
              <>
                {" · "}
                <a href={slackLink(o.player_slack)} target="_blank" rel="noreferrer" className="hover:text-brand">
                  {handle ?? o.player_slack}
                </a>
              </>
            )}
            {" · "}
            {new Date(o.created_at).toLocaleString()}
          </div>
          {buyer && (
            <Disclosure summary="Shipping info" className="mt-1">
              <div className="text-sm rounded border border-border bg-muted/40 p-2.5 space-y-1">
                <div>
                  <span className="text-xs text-muted-foreground">Name: </span>
                  {buyer.name || <span className="text-muted-foreground">not on file</span>}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Email: </span>
                  {buyer.email ? (
                    <a href={`mailto:${buyer.email}`} className="text-brand hover:underline">
                      {buyer.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">not on file</span>
                  )}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Address: </span>
                  {buyer.addressLines.length > 0 ? (
                    <span className="whitespace-pre-line">{buyer.addressLines.join("\n")}</span>
                  ) : (
                    <span className="text-muted-foreground">not on file</span>
                  )}
                </div>
              </div>
            </Disclosure>
          )}
          {o.claimed_by && o.status !== "pending" && (
            <div className="text-xs text-muted-foreground mt-1">
              {o.status === "cancelled"
                ? "Handled"
                : o.status === "shipped" || o.status === "done"
                  ? "Fulfilled"
                  : "Claimed"}{" "}
              by <span className="text-foreground">{o.claimed_by}</span>
              {mine && actionable ? " (you)" : ""}
              {o.shipped_at ? ` · shipped ${fmtDate(o.shipped_at)}` : ""}
              {o.status === "done" && o.done_at ? ` · done ${fmtDate(o.done_at)}` : ""}
            </div>
          )}
          {(o.status === "shipped" || o.status === "done") && o.tracking && (
            <div className="text-xs text-muted-foreground mt-1">
              Tracking: <span className="text-foreground font-mono">{o.tracking}</span> · DM&apos;d to buyer
            </div>
          )}
          {o.status !== "pending" && o.status !== "cancelled" && o.hcb_link && (
            <div className="text-xs text-muted-foreground mt-1">
              HCB:{" "}
              {isSafeUrl(o.hcb_link) ? (
                <a href={o.hcb_link} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
                  {o.hcb_link}
                </a>
              ) : (
                <span className="break-all">{o.hcb_link}</span>
              )}
            </div>
          )}
          {actionable && /robux/i.test(o.item_name ?? "") && (
            <div className="text-xs mt-1">
              <a
                href="https://www.roblox.com/fr/shopgiftcards?location=us&locale=us_us"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Buy Robux here
              </a>
            </div>
          )}
          {o.buyer_note && (
            <div className="text-xs mt-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
              <span className="font-semibold">Note from buyer:</span> {o.buyer_note}
            </div>
          )}
          {o.status === "cancelled" && o.note && (
            <div className="text-xs text-muted-foreground mt-1">{o.note}</div>
          )}
          {o.flagged_at && (
            <div className="text-xs mt-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1">
              <span className="font-semibold">Over budget:</span> {o.flag_note}
              <span className="text-muted-foreground">
                {" "}
                (flagged by {o.flagged_by || "a fulfiller"} on {fmtDate(o.flagged_at)})
              </span>
            </div>
          )}
        </div>
        <StageSteps status={o.status} />
      </div>

      {actionable && <OrderActions order={o} mine={mine} canManage={canManage} />}
      {actionable && o.status !== "shipped" && <FlagControls order={o} canManage={canManage} />}
      {canManage && o.status !== "pending" && o.status !== "cancelled" && (
        <EditFulfillmentInfo order={o} />
      )}
    </Card>
  );
}

// Corrects the HCB link / actual cost / tracking after the fact - deliberately
// NOT gated by `actionable`, so it still works once an order is done (the
// main pipeline actions disappear there on purpose, but a typo'd link or a
// wrong cost still needs fixing after the fact). Owner-level only, same as
// the rest of updateOrderFulfillmentInfo's gate.
function EditFulfillmentInfo({ order: o }: { order: ShopOrderRow }) {
  return (
    <Disclosure summary="Edit HCB link / cost / tracking">
      <form action={updateOrderFulfillmentInfo} className="flex items-end gap-2 flex-wrap pt-2">
        <input type="hidden" name="id" value={o.id} />
        <label className="block flex-1 min-w-64">
          <span className="block text-xs font-medium text-muted-foreground mb-1">HCB link</span>
          <Input
            name="hcbLink"
            type="url"
            maxLength={300}
            required
            defaultValue={o.hcb_link}
            className="w-full text-sm"
          />
        </label>
        <label className="block w-32 shrink-0">
          <span className="block text-xs font-medium text-muted-foreground mb-1">Actual cost ($)</span>
          <Input
            name="actualCostUsd"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={o.actual_cost_usd !== null ? Number(o.actual_cost_usd) : undefined}
            className="w-full text-sm"
          />
        </label>
        <label className="block flex-1 min-w-48">
          <span className="block text-xs font-medium text-muted-foreground mb-1">Tracking</span>
          <Input name="tracking" maxLength={120} defaultValue={o.tracking} className="w-full text-sm" />
        </label>
        <PendingButton variant="outline" pendingText="Saving…">
          Save
        </PendingButton>
      </form>
    </Disclosure>
  );
}

// Sourcing escalation. A fulfiller who can't buy the item for what the player's
// pixels are worth flags it here instead of ordering it over budget; an owner
// clears the flag once they've decided what to do about it.
function FlagControls({ order: o, canManage }: { order: ShopOrderRow; canManage: boolean }) {
  if (o.flagged_at) {
    if (!canManage) return null;
    return (
      <form action={clearOrderFlag}>
        <input type="hidden" name="id" value={o.id} />
        <PendingButton variant="outline" pendingText="Clearing…">
          Clear flag
        </PendingButton>
      </form>
    );
  }
  return (
    <Disclosure summary={`Can't source it for $${usdBudget(o.price)}?`}>
      <form action={flagOrderOverBudget} className="flex items-end gap-2 flex-wrap pt-2">
        <input type="hidden" name="id" value={o.id} />
        <label className="block flex-1 min-w-64">
          <span className="block text-xs font-medium text-muted-foreground mb-1">
            What&apos;s the cheapest you found, and where?
          </span>
          <Input
            name="flagNote"
            maxLength={300}
            required
            placeholder="Cheapest is $95 on Amazon, $88 refurb on eBay"
            className="w-full text-sm"
          />
        </label>
        <PendingButton
          variant="outline"
          pendingText="Flagging…"
          className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
        >
          Flag over budget
        </PendingButton>
      </form>
    </Disclosure>
  );
}

function OrderActions({
  order: o,
  mine,
  canManage,
}: {
  order: ShopOrderRow;
  mine: boolean;
  canManage: boolean;
}) {
  // Reassign, cancel/refund, and the final "mark done" close stay owner-only ,
  // fulfillers can work a claimed order but not override or refund one.
  const cancelForm = canManage ? (
    <form action={cancelOrder}>
      <input type="hidden" name="id" value={o.id} />
      <PendingButton
        variant="outline"
        pendingText="Refunding…"
        confirm={`Cancel this order and refund ${o.price} pixels to ${o.player_name}?`}
        className="text-rose-600 border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600"
      >
        Cancel &amp; refund
      </PendingButton>
    </form>
  ) : null;

  // Shipped: the only thing left is the final close, which any super can do.
  if (o.status === "shipped") {
    if (!canManage) return null;
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <form action={markOrderDone}>
          <input type="hidden" name="id" value={o.id} />
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Closing…">
            Mark done
          </PendingButton>
        </form>
      </div>
    );
  }

  // Claimed by someone else: offer to take it over rather than acting on their queue.
  if (!mine && o.status !== "pending") {
    if (!canManage) return null;
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <form action={reassignOrder}>
          <input type="hidden" name="id" value={o.id} />
          <PendingButton variant="outline" pendingText="Taking over…">
            Reassign to me
          </PendingButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  if (o.status === "pending") {
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <form action={claimOrder}>
          <input type="hidden" name="id" value={o.id} />
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Claiming…">
            Place order &amp; claim
          </PendingButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  // Ordered -> credited requires the HCB link and actual cost - the
  // transaction only exists once HCB has actually credited the card, so it
  // belongs here rather than at claim time.
  if (o.status === "ordered") {
    return (
      <div className="flex items-end gap-2 flex-wrap">
        <form action={markOrderCredited} className="flex items-end gap-2 flex-1 min-w-64">
          <input type="hidden" name="id" value={o.id} />
          <label className="block flex-1 min-w-0">
            <span className="block text-xs font-medium text-muted-foreground mb-1">
              HCB link (the transaction or grant this was paid from)
            </span>
            <Input
              name="hcbLink"
              type="url"
              maxLength={300}
              required
              placeholder="https://hcb.hackclub.com/…"
              className="w-full text-sm"
            />
          </label>
          <label className="block w-32 shrink-0">
            <span className="block text-xs font-medium text-muted-foreground mb-1">Actual cost ($)</span>
            <Input
              name="actualCostUsd"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder={usdBudget(o.price)}
              className="w-full text-sm"
            />
          </label>
          <PendingButton className="bg-brand text-white border-transparent" pendingText="Saving…">
            Mark credited (receipt uploaded)
          </PendingButton>
        </form>
        {cancelForm}
      </div>
    );
  }

  // credited -> ship with a required tracking number.
  return (
    <div className="flex items-end gap-2 flex-wrap">
      <form action={shipOrder} className="flex items-end gap-2 flex-1 min-w-64">
        <input type="hidden" name="id" value={o.id} />
        <label className="block flex-1 min-w-0">
          <span className="block text-xs font-medium text-muted-foreground mb-1">
            Tracking number (DM&apos;d to the buyer)
          </span>
          <Input name="tracking" maxLength={120} required placeholder="1Z…" className="w-full text-sm" />
        </label>
        <PendingButton className="bg-brand text-white border-transparent" pendingText="Shipping…">
          Mark shipped
        </PendingButton>
      </form>
      {cancelForm}
    </div>
  );
}
