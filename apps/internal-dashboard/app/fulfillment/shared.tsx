import { config } from "@/app/_generated/config";
import { isSafeUrl } from "@/lib/safeUrl";
import { grantOrderFaceCents } from "@/lib/grantValue";
import { TextLink, type Tone } from "@/app/_ui/ui";
import type { OrderStatus } from "@/lib/db";

export const STAGE_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  claimed: "Claimed",
  ordered: "Claimed",
  credited: "Claimed",
  shipped: "Fulfilled",
  done: "Fulfilled",
  cancelled: "Cancelled",
};

export const STAGE_TONE: Record<OrderStatus, Tone> = {
  pending: "warning",
  claimed: "info",
  ordered: "info",
  credited: "info",
  shipped: "success",
  done: "success",
  cancelled: "neutral",
};

export const STAGE_HINT: Record<OrderStatus, string> = {
  pending: "Request received",
  claimed: "Assigned to a fulfiller",
  ordered: "Assigned; purchase recorded",
  credited: "Assigned; purchase recorded",
  shipped: "Fulfilled; tracking on file",
  done: "Bought and recorded",
  cancelled: "Refunded",
};

// The visible item pipeline is three steps. ordered/credited/shipped are legacy
// states from the old five-stage pipeline and fold into Claimed/Fulfilled.
export const ORDER_STEPS: OrderStatus[] = ["pending", "claimed", "done"];

export function stageIndex(status: OrderStatus): number {
  if (status === "pending") return 0;
  if (status === "claimed" || status === "ordered" || status === "credited") return 1;
  if (status === "done" || status === "shipped") return 2;
  return -1;
}

// What the order's pixels are actually worth in dollars, i.e. the ceiling a
// fulfiller has to source the item under.
export function usdBudget(pricePx: number): string {
  return (pricePx * config.economy.pixelValueUsd).toFixed(2);
}

// The budget a fulfiller should actually see. Grants pay out a round dollar
// face value ("A $10 grant"), not the pixel price's dollar value: 2x AI
// Credits is budgeted at $20, never the $22.20 internal ceiling. Non-grants,
// and grants whose description cannot be read, keep the pixel budget.
export function orderBudgetUsd(o: {
  price: number;
  quantity: number;
  item_category?: string | null;
  item_description?: string | null;
}): string {
  const faceCents = grantOrderFaceCents(o);
  return faceCents == null ? usdBudget(o.price) : (faceCents / 100).toFixed(2);
}

export function slackLink(id: string): string {
  return `https://slack.com/app_redirect?channel=${id}`;
}

export function SafeLink({ url }: { url: string }) {
  return isSafeUrl(url) ? (
    <TextLink href={url} external className="break-all">
      {url}
    </TextLink>
  ) : (
    <span className="break-all">{url}</span>
  );
}

export { ageLabel, lastUpdated } from "@/lib/fulfillmentView";
