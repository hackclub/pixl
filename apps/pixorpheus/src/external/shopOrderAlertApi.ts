import crypto from "crypto";
import express from "express";
import { config } from "../config.generated.js";
import { db } from "../db/client.js";
import { escapeMrkdwn } from "../slack/escape.js";
import { isSlackUserId } from "../slack/pixlMembership.js";
import { app, http } from "../slack/app.js";

function requireExternalApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key) {
    res.status(503).json({ error: "API key not configured" });
    return;
  }
  const provided = req.headers["x-api-key"];
  const providedBuf = Buffer.from(typeof provided === "string" ? provided : "");
  const keyBuf = Buffer.from(key);
  if (providedBuf.length !== keyBuf.length || !crypto.timingSafeEqual(providedBuf, keyBuf)) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  next();
}

function safeLabel(value: unknown, max: number): string {
  const text = (typeof value === "string" ? value : String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return escapeMrkdwn(text);
}

http.post(
  "/api/external/shop-order-alert",
  express.json({ limit: "4kb" }),
  requireExternalApiKey,
  async (req, res) => {
    const orderId = req.body?.orderId;
    if (typeof orderId !== "number" || !Number.isSafeInteger(orderId) || orderId < 1) {
      return res.status(400).json({ error: "Invalid orderId" });
    }

    const [orderResult, recipientResult] = await Promise.all([
      db()
        .from("shop_orders")
        .select("id, user_id, item_name, option, quantity, price")
        .eq("id", orderId)
        .maybeSingle(),
      db().from("fulfiller_order_alerts").select("slack_user_id"),
    ]);
    if (orderResult.error || recipientResult.error) {
      console.error(
        "[shop-order-alert] lookup failed:",
        orderResult.error?.message ?? recipientResult.error?.message,
      );
      return res.status(503).json({ error: "lookup_failed" });
    }
    if (!orderResult.data) return res.status(404).json({ error: "order_not_found" });

    const recipients = (recipientResult.data ?? [])
      .map((row) => row.slack_user_id as string)
      .filter(isSlackUserId);
    if (recipients.length === 0) return res.json({ ok: true, sent: 0, failed: 0 });

    const order = orderResult.data;
    const { data: player, error: playerError } = await db()
      .from("users")
      .select("display_name")
      .eq("id", order.user_id)
      .maybeSingle();
    if (playerError) {
      console.error("[shop-order-alert] player lookup failed:", playerError.message);
    }

    const itemName = safeLabel(order.item_name, 120) || "Shop item";
    const option = safeLabel(order.option, 100);
    const rawQuantity = Number(order.quantity);
    const quantity = Number.isSafeInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
    const rawPrice = Number(order.price);
    const total = Number.isSafeInteger(rawPrice) && rawPrice >= 0 ? `${rawPrice.toLocaleString("en-US")} px` : "unknown";
    const playerName = safeLabel(player?.display_name, 80) || "Player";
    const queueUrl = `${config.urls.dash}/fulfillment?status=all&order=${orderId}`;
    const itemLine = `${quantity > 1 ? `${quantity}× ` : ""}${itemName}${option ? ` · ${option}` : ""}`;
    const message = `*New order received!*\nOrder: #${orderId}\nItem: ${itemLine}\nOrdered by: ${playerName}\nTotal: ${total}\n<${queueUrl}|View order>`;

    let sent = 0;
    let failed = 0;
    await Promise.all(
      recipients.map(async (slackUserId) => {
        try {
          await app.client.chat.postMessage({
            channel: slackUserId,
            text: message,
            unfurl_links: false,
            unfurl_media: false,
          });
          sent++;
        } catch (error: any) {
          failed++;
          console.error(
            `[shop-order-alert] DM to ${slackUserId} failed:`,
            error?.data?.error ?? error?.message ?? error,
          );
        }
      }),
    );

    res.json({ ok: true, sent, failed });
  },
);
