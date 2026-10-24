import { audit } from "../audit.js";
import { db } from "../db/client.js";
import { isSlackUserId } from "../slack/pixlMembership.js";

export type FulfillmentAlertAction = "on" | "off" | "status" | "help";

const COMMAND = "pixo:order-alerts";
const USAGE =
  "Use `pixo:order-alerts on`, `pixo:order-alerts off`, or `pixo:order-alerts status` in a DM with Pixorpheus.";

export function parseFulfillmentAlertCommand(text: string): FulfillmentAlertAction | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith(COMMAND)) return null;
  if (trimmed.length > COMMAND.length && !/\s/.test(trimmed[COMMAND.length]!)) return null;

  const action = trimmed.slice(COMMAND.length).trim().toLowerCase();
  if (action === "on" || action === "off" || action === "status") return action;
  return "help";
}

export async function handleFulfillmentAlertCommand(
  slackUserId: string,
  action: FulfillmentAlertAction,
): Promise<string> {
  if (action === "help") return USAGE;
  if (!isSlackUserId(slackUserId)) return "I couldn't verify your Slack account.";

  try {
    const { data: fulfiller, error: fulfillerError } = await db()
      .from("fulfillers")
      .select("slack_user_id")
      .eq("slack_user_id", slackUserId)
      .maybeSingle();
    if (fulfillerError) throw fulfillerError;
    if (!fulfiller) return "Only people currently listed as Pixl fulfillers can use these alerts.";

    if (action === "status") {
      const { data, error } = await db()
        .from("fulfiller_order_alerts")
        .select("slack_user_id")
        .eq("slack_user_id", slackUserId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? "You're opted in to new order DMs. Use `pixo:order-alerts off` to stop them."
        : "You're opted out of new order DMs. Use `pixo:order-alerts on` to get them.";
    }

    if (action === "on") {
      const { error } = await db()
        .from("fulfiller_order_alerts")
        .upsert({ slack_user_id: slackUserId }, { onConflict: "slack_user_id", ignoreDuplicates: true });
      if (error) throw error;
      await audit(
        {
          action: "fulfillment.order_alerts.opt_in",
          slackId: slackUserId,
          target: "fulfiller_order_alerts",
          result: "ok",
        },
        true,
      );
      return "You're opted in. I'll DM you when a new order arrives; use `pixo:order-alerts off` any time to stop them.";
    }

    const { error } = await db().from("fulfiller_order_alerts").delete().eq("slack_user_id", slackUserId);
    if (error) throw error;
    await audit(
      {
        action: "fulfillment.order_alerts.opt_out",
        slackId: slackUserId,
        target: "fulfiller_order_alerts",
        result: "ok",
      },
      true,
    );
    return "You're opted out. I won't DM you about new orders.";
  } catch (error) {
    console.error("[fulfillment-alerts] preference update failed:", (error as Error)?.message ?? error);
    await audit(
      {
        action: `fulfillment.order_alerts.${action}`,
        slackId: slackUserId,
        target: "fulfiller_order_alerts",
        result: "error",
        meta: { reason: "database_error" },
      },
      true,
    );
    return "I couldn't update your order alerts right now. Try again in a bit.";
  }
}
