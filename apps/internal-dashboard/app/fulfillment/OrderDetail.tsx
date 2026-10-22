import type { ReactNode } from "react";
import type { BuyerDetails, OrderStatus, ShopOrderRow } from "@/lib/db";
import { ORDER_STAGES } from "@/lib/db";
import { visibleOrderActions } from "@/lib/fulfillmentAccess";
import {
  Badge,
  ButtonLink,
  Callout,
  DescriptionList,
  Icon,
  Mono,
  Muted,
  TextLink,
  formatDate,
  formatDateTime,
} from "@/app/_ui/ui";
import { SlackHandle } from "./SlackHandle";
import { EditFulfillmentInfo, FlagControls, OrderActions } from "./OrderActions";
import { ItemThumb, TypeBadge } from "./OrderList";
import { STAGE_HINT, STAGE_LABEL, STAGE_TONE, SafeLink, slackLink, usdBudget } from "./shared";

// These two ship in a plain envelope with no carrier tracking of their own,
// so a printable address label (app/fulfillment/label/[id]) is how the
// fulfiller actually gets it to the right mailbox.
const LABEL_ELIGIBLE_ITEMS = new Set(["Random Desk Object", "Signed Org Photo"]);

function stageStamp(o: ShopOrderRow, s: OrderStatus): string | null {
  const v = { pending: o.created_at, ordered: o.ordered_at, credited: o.credited_at, shipped: o.shipped_at, done: o.done_at, cancelled: null }[s];
  return v ? formatDate(v) : null;
}

function Stepper({ order: o }: { order: ShopOrderRow }) {
  if (o.status === "cancelled") {
    return (
      <Callout tone="danger" icon="important">
        <strong>Cancelled.</strong> {o.note || "This order was cancelled and the pixels refunded."}
      </Callout>
    );
  }
  const idx = ORDER_STAGES.indexOf(o.status);
  return (
    <ol className="fw-steps" aria-label="Order progress">
      {ORDER_STAGES.map((s, i) => (
        <li
          key={s}
          className="fw-step"
          data-state={i < idx ? "done" : i === idx ? "current" : "todo"}
          aria-current={i === idx ? "step" : undefined}
        >
          <span className="fw-step-dot">{i + 1}</span>
          <span className="fw-step-label">{STAGE_LABEL[s]}</span>
          <span className="fw-step-hint">{STAGE_HINT[s]}</span>
          {i <= idx && stageStamp(o, s) && <span className="fw-step-hint">{stageStamp(o, s)}</span>}
        </li>
      ))}
    </ol>
  );
}

function Panel({ title, icon, children, aside }: { title: string; icon: "message" | "pin" | "person" | "link" | "bolt"; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="fw-panel">
      <header className="fw-panel-head">
        <h3 className="hc-heading">
          <Icon glyph={icon} size={20} className="hc-muted" />
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function OnFile({ value }: { value: ReactNode }) {
  return value ? <>{value}</> : <Muted>Not available</Muted>;
}

function ShippingPanel({ order: o, buyer, country }: { order: ShopOrderRow; buyer?: BuyerDetails; country?: string }) {
  if (!buyer) {
    return (
      <p className="text-sm">
        {country || <Muted>Country not on file</Muted>}{" "}
        <Muted>· full shipping info appears once you claim it</Muted>
      </p>
    );
  }
  return (
    <>
      <DescriptionList
        items={[
          ["Name", <OnFile key="n" value={buyer.name} />],
          ["Email", <OnFile key="e" value={buyer.email && <TextLink href={`mailto:${buyer.email}`} external>{buyer.email}</TextLink>} />],
          ["Phone", <OnFile key="p" value={buyer.phone} />],
          [
            "Address",
            <OnFile
              key="a"
              value={buyer.addressLines.length > 0 && <span className="whitespace-pre-line">{buyer.addressLines.join("\n")}</span>}
            />,
          ],
        ]}
      />
      {LABEL_ELIGIBLE_ITEMS.has(o.item_name) && o.status !== "cancelled" && (
        <div className="mt-3">
          <ButtonLink href={`/fulfillment/label/${o.id}`} variant="outline" size="sm" icon="post">
            Print shipping label
          </ButtonLink>
        </div>
      )}
    </>
  );
}

export function OrderDetail({
  order: o,
  buyer,
  country,
  requesterName,
  mine,
  ownOrder,
  canManage,
}: {
  order: ShopOrderRow;
  buyer?: BuyerDetails;
  country?: string;
  requesterName: string;
  mine: boolean;
  ownOrder: boolean;
  canManage: boolean;
}) {
  const actionable = o.status !== "done" && o.status !== "cancelled";
  const budget = usdBudget(o.price);
  const visible = visibleOrderActions({
    status: o.status,
    flagged: Boolean(o.flagged_at),
    hasBuyerSlack: Boolean(o.player_slack),
    mine,
    ownOrder,
    canManage,
  });
  const overBudget = o.actual_cost_usd !== null && Number(o.actual_cost_usd) > Number(budget);

  const facts: [ReactNode, ReactNode][] = [];
  if (o.claimed_by && o.status !== "pending") {
    const verb = o.status === "cancelled" ? "Handled by" : o.status === "shipped" || o.status === "done" ? "Fulfilled by" : "Claimed by";
    facts.push([
      verb,
      <>
        {o.claimed_by}
        {mine && actionable ? " (you)" : ""}
        {o.shipped_at && <Muted> · shipped {formatDate(o.shipped_at)}</Muted>}
        {o.status === "done" && o.done_at && <Muted> · done {formatDate(o.done_at)}</Muted>}
      </>,
    ]);
  }
  if (o.actual_cost_usd !== null) {
    facts.push(["Actual cost", <Badge key="c" tone={overBudget ? "danger" : "success"} outline>${Number(o.actual_cost_usd).toFixed(2)}</Badge>]);
  }
  if ((o.status === "shipped" || o.status === "done") && o.tracking) {
    facts.push(["Tracking", <><Mono>{o.tracking}</Mono> <Muted>· DM&apos;d to buyer</Muted></>]);
  }
  if (o.status !== "pending" && o.status !== "cancelled" && o.hcb_link) facts.push(["HCB", <SafeLink key="hcb" url={o.hcb_link} />]);
  if (o.status === "cancelled" && o.note) facts.push(["Note", o.note]);

  return (
    <article className="fw-detail" aria-label={`Order ${o.id}`}>
      <header className="fw-detail-head">
        <ItemThumb src={o.item_image_url} size={72} />
        <div className="min-w-0 flex-1">
          <h2 className="hc-heading fw-title">
            {o.quantity > 1 ? `${o.quantity}x ` : ""}
            {o.item_name || "(item removed)"}
          </h2>
          <p className="fw-meta">
            <TextLink href={`/players/${o.user_id}`} className="font-bold">
              {requesterName}
            </TextLink>
            {o.player_slack && (
              <>
                {" · "}
                <TextLink href={slackLink(o.player_slack)} external>
                  <SlackHandle id={o.player_slack} />
                </TextLink>
              </>
            )}
            {" · "}
            <span className="hc-muted">{formatDateTime(o.created_at)}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={STAGE_TONE[o.status] ?? "neutral"}>{STAGE_LABEL[o.status] ?? o.status}</Badge>
            {o.option && <Badge>{o.option}</Badge>}
            {o.item_beacon_locked && (
              <Badge tone="yellow" icon="rep">
                Beacon reward
              </Badge>
            )}
          </div>
        </div>
        <dl className="fw-tiles">
          <div><dt>Budget</dt><dd>${budget}</dd></div>
          <div><dt>Pixel cost</dt><dd>{o.price.toLocaleString()} px</dd></div>
          <div><dt>Type</dt><dd>{o.item_category ? <TypeBadge category={o.item_category} /> : <Muted>-</Muted>}</dd></div>
        </dl>
      </header>

      <Stepper order={o} />

      {o.item_beacon_locked && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--hc-yellow)_45%,var(--border))] bg-[color-mix(in_srgb,var(--hc-yellow)_10%,var(--surface))] px-4 py-3">
          <Icon glyph="rep" size={20} className="mt-0.5 shrink-0 text-[var(--hc-yellow)]" />
          <p className="text-sm">
            <strong>Beacon reward.</strong> This item is Beacon-locked, so the player needed a Beacon unlock to order
            it. Nothing changes for fulfillment: order and ship it like any other request.
          </p>
        </div>
      )}

      {o.flagged_at && (
        <Callout tone="danger" icon="important">
          <strong>Over budget:</strong> {o.flag_note}{" "}
          <Muted>(flagged by {o.flagged_by || "a fulfiller"} on {formatDate(o.flagged_at)})</Muted>
        </Callout>
      )}

      <div className="fw-cols">
        <div className="fw-col">
          <Panel title="Buyer note" icon="message">
            {o.buyer_note ? <p className="fw-note">{o.buyer_note}</p> : <Muted>The buyer left no note.</Muted>}
          </Panel>
          <Panel title="Shipping info" icon="pin">
            <ShippingPanel order={o} buyer={buyer} country={country} />
          </Panel>
        </div>
        <div className="fw-col">
          <Panel title="Requester" icon="person">
            <DescriptionList
              items={[
                ["Player", <TextLink key="p" href={`/players/${o.user_id}`} className="font-bold">{requesterName}</TextLink>],
                [
                  "Slack",
                  o.player_slack ? (
                    <TextLink key="s" href={slackLink(o.player_slack)} external>
                      <SlackHandle id={o.player_slack} />
                    </TextLink>
                  ) : null,
                ],
                ["Placed", formatDateTime(o.created_at)],
              ]}
            />
          </Panel>
          <Panel title="Previous source / vendor" icon="link">
            {o.item_source_url ? (
              <>
                <p className="hc-caption text-xs">Last bought from</p>
                <p className="mt-1 text-sm">
                  <SafeLink url={o.item_source_url} />
                </p>
                <p className="hc-caption mt-2 text-xs">Use the same vendor as previous purchases when possible.</p>
              </>
            ) : (
              <Muted>No previous source on file for this item.</Muted>
            )}
            {o.item_alt_source_url && (
              <>
                <p className="hc-caption mt-3 text-xs">Alternate link</p>
                <p className="mt-1 text-sm">
                  <SafeLink url={o.item_alt_source_url} />
                </p>
              </>
            )}
          </Panel>
          {facts.length > 0 && (
            <Panel title="Fulfillment" icon="bolt">
              <DescriptionList items={facts} />
            </Panel>
          )}
        </div>
      </div>

      {actionable && /robux/i.test(o.item_name ?? "") && (
        <TextLink href="https://www.roblox.com/fr/shopgiftcards?location=us&locale=us_us" external className="text-sm">
          Buy Robux here
        </TextLink>
      )}

      {visible.any && (
        <Panel title="Actions" icon="bolt">
          <div className="flex flex-col gap-3">
            {visible.primary && <OrderActions order={o} mine={mine} ownOrder={ownOrder} canManage={canManage} />}
            {visible.flag && <FlagControls order={o} canManage={canManage} budget={budget} />}
            {visible.contact && o.player_slack && (
              <div>
                <ButtonLink href={slackLink(o.player_slack)} external variant="outline" size="sm" icon="message">
                  Contact buyer
                </ButtonLink>
              </div>
            )}
            {visible.edit && <EditFulfillmentInfo order={o} />}
          </div>
        </Panel>
      )}
    </article>
  );
}
