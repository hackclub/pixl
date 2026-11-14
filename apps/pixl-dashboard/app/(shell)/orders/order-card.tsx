import { cn } from "@/lib/cn";
import { badgeVariants, panel } from "@/components/ui/primitives";
import { CancelOrderButton } from "./cancel-order-button";
import { TimeAgo } from "./time-ago";

export interface Order {
  id: number;
  status: string;
  item_name?: string | null;
  option?: string | null;
  quantity?: number | null;
  price: number;
  created_at?: string | null;
  queue_position?: number | null;
  queue_total?: number | null;
  tracking?: string | null;
  note?: string | null;
  /** A grant order: sent by email as an HCB grant, no shipping. */
  is_grant?: boolean | null;
}

const STAGES: [string, string][] = [
  ["pending", "NEW"],
  ["claimed", "CLAIMED"],
  ["ordered", "ORDERED"],
  ["credited", "PAID"],
  ["shipped", "SHIPPED"],
  ["done", "DONE"],
];

// Grants skip the shipping stages: New, Claimed, then the grant is sent.
const GRANT_STAGES: [string, string][] = [
  ["pending", "NEW"],
  ["claimed", "CLAIMED"],
  ["done", "GRANT SENT"],
];

type BadgeTone = "default" | "gold" | "teal" | "green" | "red";

const BADGE: Record<string, [string, BadgeTone]> = {
  pending: ["AWAITING", "default"],
  claimed: ["PREPARING", "teal"],
  ordered: ["ORDERED", "gold"],
  credited: ["PAID", "gold"],
  shipped: ["SHIPPED", "teal"],
  done: ["DELIVERED", "green"],
  cancelled: ["CANCELLED · REFUNDED", "red"],
};

const meta = "flex flex-wrap items-center gap-[6px] text-[13px] text-dim";

function Tracker({ status, stages = STAGES }: { status: string; stages?: [string, string][] }) {
  const idx = stages.findIndex(([s]) => s === status);
  return (
    <div className="flex items-start">
      {stages.map(([s, label], i) => {
        const filled = i <= idx;
        const current = i === idx;
        return (
          <div
            key={s}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-[6px]",
              "not-last:after:absolute not-last:after:top-[6px] not-last:after:left-1/2 not-last:after:h-[2px]",
              "not-last:after:w-full not-last:after:bg-stroke not-last:after:content-['']",
              filled && "not-last:after:bg-teal",
            )}
          >
            <span
              className={cn(
                "relative z-1 size-[14px] border-2 border-stroke bg-panel-deep",
                filled && "border-teal bg-teal",
                current && "border-gold bg-gold shadow-[0_0_0_4px_color-mix(in_srgb,var(--gold)_30%,transparent)]",
              )}
            />
            <span className={cn("font-pixel text-[10px] tracking-[1px] text-faint", filled && "text-ink")}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function OrderCard({ order: o }: { order: Order }) {
  // Grants that are new, claimed or sent use the short timeline. One that was
  // already mid-way through the old shipping stages keeps the standard one.
  const grantFlow = o.is_grant === true && (o.status === "pending" || o.status === "claimed" || o.status === "done");
  const [badgeText, badgeTone] = grantFlow && o.status === "done" ? ["GRANT SENT", "green" as BadgeTone] : (BADGE[o.status] ?? ["", "default"]);
  const qty = Number(o.quantity) || 1;
  return (
    <div
      className={cn(panel, "flex flex-col gap-[13px] px-[18px] py-[16px]", o.status === "cancelled" && "opacity-75")}
    >
      <div className="flex flex-wrap items-baseline gap-[10px]">
        <span className="font-pixel text-[17px] tracking-[.5px] text-ink">
          {qty > 1 ? `${qty}× ` : ""}
          {o.item_name || "Item"}
        </span>
        <span className="inline-flex items-center gap-[5px] text-[15px] font-bold tabular-nums text-gold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/pixel.png" alt="" className="size-[14px]" />
          {Number(o.price).toLocaleString()} PX
        </span>
        {badgeText ? <span className={badgeVariants({ tone: badgeTone })}>{badgeText}</span> : null}
        {o.option ? <span className={badgeVariants()}>{o.option}</span> : null}
        {o.created_at ? <TimeAgo iso={o.created_at} className="ml-auto text-[13px] text-faint" /> : null}
      </div>

      {o.status === "cancelled" ? (
        <div className="text-[14px] text-dim">Refunded to your wallet.{o.note ? ` ${o.note}` : ""}</div>
      ) : (
        <>
          <Tracker status={o.status} stages={grantFlow ? GRANT_STAGES : STAGES} />
          {o.status === "pending" && o.queue_position ? (
            <div className={meta}>
              #{o.queue_position}
              {o.queue_total ? ` of ${o.queue_total}` : ""} in line to be claimed by fulfillment
            </div>
          ) : null}
        </>
      )}

      {grantFlow && o.status === "done" ? (
        <div className={meta}>
          Check your email for the HCB grant invite.
          {o.tracking ? (
            <>
              {" "}
              Grant <span className="font-mono text-ink">{o.tracking}</span>
            </>
          ) : null}
        </div>
      ) : (o.status === "shipped" || o.status === "done") && o.tracking ? (
        <div className={meta}>
          Tracking <span className="font-mono text-ink">{o.tracking}</span>
          <span className="text-muted"> · DM&apos;d to you</span>
        </div>
      ) : null}

      {o.status === "pending" ? (
        <div className={meta}>
          <CancelOrderButton id={Number(o.id)} />
        </div>
      ) : null}
    </div>
  );
}
