import crypto from "crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { app, receiver } from "../slack/app.js";
import {
  ensurePixlChannelMembership,
  isSlackUserId,
  type SlackConversationClient,
} from "../slack/pixlMembership.js";
import { resolveTicket } from "../tickets/service.js";

// Lets the Pixl HQ dashboard (apps/dashboard) resolve a ticket through this bot
// instead of its own separate, more narrowly-scoped Slack app, this bot is
// reliably a member of the help channel, that one isn't. Reuses the exact same
// resolveTicket() the in-thread "Mark resolved" button calls.
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

function slackUserIdFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  if (!("slackId" in body) || typeof body.slackId !== "string") return null;
  const slackId = body.slackId.trim();
  return isSlackUserId(slackId) ? slackId : null;
}

const pixlMembershipClient: SlackConversationClient = {
  conversations: {
    invite: (args) => app.client.conversations.invite(args),
  },
};

receiver.app.post("/api/external/pixl-channel/join", express.json(), requireExternalApiKey, async (req, res) => {
  const slackId = slackUserIdFromBody(req.body);
  if (!slackId) return res.status(400).json({ error: "Invalid Slack user ID" });

  const result = await ensurePixlChannelMembership(slackId, pixlMembershipClient);
  switch (result.kind) {
    case "joined":
      return res.json({ ok: true, membership: "joined" });
    case "already_member":
      return res.json({ ok: true, membership: "already_member" });
    case "failed":
      console.error("[pixl-membership] invite failed", result.errorCode ?? "unknown_error");
      return res.status(502).json({ error: "Slack invite failed" });
  }
});

receiver.app.post("/api/external/tickets/:ts/resolve", express.json(), requireExternalApiKey, async (req, res) => {
  const ts = req.params.ts as string;
  const slackId = req.body?.slackId?.trim();
  if (!slackId) return res.status(400).json({ error: "Missing slackId" });

  try {
    const result = await resolveTicket(ts, slackId, app.client);
    if (result === "not_found") return res.status(404).json({ error: "Ticket not found" });
    if (result === "already_closed") return res.json({ ok: true, alreadyClosed: true });
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[ticketApi] resolve failed:", e?.message ?? e);
    res.status(500).json({ error: "internal_error" });
  }
});
