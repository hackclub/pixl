import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { validate, v } from "../http/validate.js";

const router = Router();

// Drop a notification into a user's inbox. Best-effort: failures are logged,
// never thrown, so they can't break the action that triggered them.
export async function addNotification(
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  const { error } = await db
    .from("notifications")
    .insert({ user_id: userId, title, body });
  if (error) console.error("[notifications] insert failed", error);
}

// Service hook (behind adminServiceGate, see index.ts): push a notification
// to one player, or omit userId to broadcast to every registered player.
const adminNotificationBody = z.object({
  title: z.string().max(1000),
  body: z.string().max(5000),
  userId: v.uuid.optional(),
});

router.post("/api/admin/notifications", validate({ query: v.noQuery, body: adminNotificationBody }), async (req, res) => {
  const title =
    typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 100) : "";
  const body =
    typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 500) : "";
  if (!title || !body)
    return res.status(400).json({ ok: false, reason: "title and body required." });

  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (userId) {
    const { error } = await db
      .from("notifications")
      .insert({ user_id: userId, title, body });
    if (error) {
      console.error("[notifications] admin insert failed", error);
      return res.status(500).json({ ok: false });
    }
    return res.json({ ok: true, sent: 1 });
  }

  const { data, error } = await db.from("users").select("id");
  if (error) {
    console.error("[notifications] admin user list failed", error);
    return res.status(500).json({ ok: false });
  }
  const rows = (data ?? []).map((u) => ({
    user_id: u.id as string,
    title,
    body,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await db
      .from("notifications")
      .insert(rows.slice(i, i + 500));
    if (insertError) {
      console.error("[notifications] admin broadcast failed", insertError);
      return res.status(500).json({ ok: false, sent: i });
    }
  }
  res.json({ ok: true, sent: rows.length });
});

router.get("/api/notifications", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  // Bound the inbox list, not the badge: older unread messages still count.
  const [listing, unreadTotal] = await Promise.all([
    db.from("notifications").select("*")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("notifications").select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .eq("read", false)
      // pgCompat does not implement Supabase head:true: without limit(0) it
      // fetches every matching ID before issuing the separate exact COUNT.
      .limit(0),
  ]);
  if (listing.error || unreadTotal.error || unreadTotal.count === null) {
    console.error("[notifications] list/count failed", listing.error ?? unreadTotal.error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true, notifications: listing.data ?? [], unread: unreadTotal.count });
});

router.post("/api/notifications/read", validate({ query: v.noQuery, body: v.empty }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { error } = await db
    .from("notifications")
    .update({ read: true })
    .eq("user_id", session.userId)
    .eq("read", false);
  if (error) {
    console.error("[notifications] read failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

export default router;
