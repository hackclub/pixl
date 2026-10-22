import Link from "next/link";
import type { ShopOrderRow } from "@/lib/db";
import { SHOP_CATEGORY_LABELS } from "@/lib/shopCategories";
import { isSafeImageUrl } from "@/lib/safeUrl";
import { Badge, Icon, type Tone } from "@/app/_ui/ui";
import { SlackHandle } from "./SlackHandle";
import { STAGE_LABEL, STAGE_TONE, ageLabel, lastUpdated, usdBudget } from "./shared";

export function ItemThumb({ src, size = 40 }: { src: string | null | undefined; size?: number }) {
  const style = { width: size, height: size };
  if (isSafeImageUrl(src)) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={style}
        className="fw-thumb"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span style={style} className="fw-thumb fw-thumb-empty hc-muted" aria-hidden>
      <Icon glyph="package" size={Math.round(size * 0.5)} />
    </span>
  );
}

const TYPE_LABEL: Partial<Record<NonNullable<ShopOrderRow["item_category"]>, string>> = { software: "Software", grants: "Grant", printers: "Printer", kits: "Kit" };

export function typeTone(category: ShopOrderRow["item_category"]): Tone {
  if (category === "software") return "purple";
  if (category === "grants") return "cyan";
  return "info";
}

export function TypeBadge({ category }: { category: ShopOrderRow["item_category"] }) {
  if (!category) return null;
  return <Badge tone={typeTone(category)} outline>{TYPE_LABEL[category] ?? SHOP_CATEGORY_LABELS[category]}</Badge>;
}

export function OrderList({
  orders,
  selectedId,
  hrefFor,
  nameFor,
  now,
}: {
  orders: ShopOrderRow[];
  selectedId: number | null;
  hrefFor: (id: number) => string;
  nameFor: (o: ShopOrderRow) => string;
  now: number;
}) {
  return (
    <div className="fw-table" role="list" aria-label="Fulfillment requests">
      <div className="fw-row fw-head" aria-hidden>
        <span>Item</span>
        <span>Requester</span>
        <span>Budget</span>
        <span>Pixels</span>
        <span>Type</span>
        <span>Status</span>
        <span>Updated</span>
      </div>
      {orders.map((o) => {
        const selected = o.id === selectedId;
        return (
          <Link
            key={o.id}
            href={hrefFor(o.id)}
            scroll={false}
            role="listitem"
            aria-current={selected ? "true" : undefined}
            className="fw-row fw-item"
            data-selected={selected ? "true" : undefined}
          >
            <span className="fw-cell fw-cell-item">
              <ItemThumb src={o.item_image_url} />
              <span className="min-w-0">
                <span className="fw-name">
                  {o.quantity > 1 ? `${o.quantity}x ` : ""}
                  {o.item_name || "(item removed)"}
                </span>
                {o.option && <span className="fw-sub">{o.option}</span>}
                {o.item_beacon_locked && (
                  <span className="mt-1 flex">
                    <Badge tone="yellow" icon="rep">
                      Beacon reward
                    </Badge>
                  </span>
                )}
                {o.flagged_at && <span className="fw-flag">Over budget</span>}
              </span>
            </span>
            <span className="fw-cell min-w-0">
              <span className="fw-name">{nameFor(o)}</span>
              {o.player_slack && (
                <span className="fw-sub">
                  <SlackHandle id={o.player_slack} />
                </span>
              )}
            </span>
            <span className="fw-cell tabular-nums">${usdBudget(o.price)}</span>
            <span className="fw-cell tabular-nums fw-px">{o.price.toLocaleString()} px</span>
            <span className="fw-cell">
              <TypeBadge category={o.item_category} />
            </span>
            <span className="fw-cell">
              <span className="fw-status" data-tone={STAGE_TONE[o.status] ?? "neutral"}>
                {STAGE_LABEL[o.status] ?? o.status}
              </span>
            </span>
            <span className="fw-cell hc-muted whitespace-nowrap">{ageLabel(lastUpdated(o), now)}</span>
          </Link>
        );
      })}
    </div>
  );
}
