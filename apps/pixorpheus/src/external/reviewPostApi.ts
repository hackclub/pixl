import crypto from "crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { PIXL_REVIEW_CHANNEL } from "../constants.js";
import { app, receiver } from "../slack/app.js";

// Lets the Pixl HQ dashboard announce review verdicts (approved / changes
// requested) publicly in the review channel as Pixo, instead of DMing the
// player. The dashboard composes the message (already escaped); this only
// posts it, always to the one fixed channel, so a leaked key can't be used to
// post anywhere else.
const MAX_MESSAGE_LENGTH = 3500;

function requireExternalApiKey(req: Request, res: Response, next: NextFunction) {
  const key = process.env.EXTERNAL_API_KEY;
  if (!key) return res.status(503).json({ error: "API key not configured" });
  const provided = req.headers["x-api-key"];
  const providedBuf = Buffer.from(typeof provided === "string" ? provided : "");
  const keyBuf = Buffer.from(key);
  const valid = providedBuf.length === keyBuf.length && crypto.timingSafeEqual(providedBuf, keyBuf);
  if (!valid) return res.status(401).json({ error: "Invalid API key" });
  next();
}

receiver.app.post("/api/external/review-post", express.json(), requireExternalApiKey, async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "Missing message" });
  if (message.length > MAX_MESSAGE_LENGTH)
    return res.status(400).json({ error: `message exceeds ${MAX_MESSAGE_LENGTH} characters` });

  try {
    const posted = await app.client.chat.postMessage({
      channel: PIXL_REVIEW_CHANNEL,
      text: message,
      unfurl_links: false,
      unfurl_media: false,
    });
    res.json({ ok: true, ts: posted.ts });
  } catch (e: any) {
    console.error("[review-post] send failed:", e?.data?.error ?? e?.message ?? e);
    res.status(502).json({ error: "delivery_failed" });
  }
});
