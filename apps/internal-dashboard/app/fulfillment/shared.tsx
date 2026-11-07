import { config } from "@/app/_generated/config";
import { isSafeUrl } from "@/lib/safeUrl";
import { TextLink, type Tone } from "@/app/_ui/ui";
import type { OrderStatus } from "@/lib/db";

export const STAGE_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  claimed: "Claimed",
  ordered: "Ordered",
  credited: "Credited",
  shipped: "Shipped",
  done: "Done",
  cancelled: "Cancelled",
};

export const STAGE_TONE: Record<OrderStatus, Tone> = {
  pending: "warning",
  claimed: "info",
  ordered: "info",
  credited: "purple",
  shipped: "cyan",
  done: "success",
  cancelled: "neutral",
};

export const STAGE_HINT: Record<OrderStatus, string> = {
  pending: "Request received",
  claimed: "Assigned to fulfiller; not purchased",
  ordered: "Item purchased",
  credited: "Receipt uploaded",
  shipped: "Tracking added",
  done: "Completed",
  cancelled: "Refunded",
};

// What the order's pixels are actually worth in dollars, i.e. the ceiling a
// fulfiller has to source the item under.
export function usdBudget(pricePx: number): string {
  return (pricePx * config.economy.pixelValueUsd).toFixed(2);
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
