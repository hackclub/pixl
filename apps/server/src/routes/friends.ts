import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { orValue } from "../db/pgCompat.js";
import { addNotification } from "./notifications.js";
import { presenceFor } from "../ws/gameServer.js";
import { isUserId, rowBetween, type FriendRow } from "../social.js";

const router = Router();

// All friend rows touching a user, both directions, any status.
async function rowsFor(userId: string): Promise<FriendRow[]> {
  const { data, error } = await supabase
    .from("friends")
    .select("*")
    .or(`requester_id.eq.${orValue(userId)},addressee_id.eq.${orValue(userId)}`);
  if (error) {
    console.error("[friends] rows query failed", error);
    return [];
  }
  return (data ?? []) as FriendRow[];
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("users")
    .select("id, display_name")
    .in("id", ids);
  if (error) {
    console.error("[friends] names query failed", error);
    return map;
  }
  for (const u of data ?? []) map.set(u.id as string, u.display_name as string);
  return map;
}

router.get("/api/friends", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const rows = await rowsFor(session.userId);
  const otherIds = rows.map((r) =>
    r.requester_id === session.userId ? r.addressee_id : r.requester_id,
  );
  const names = await namesFor(otherIds);

  const friends: object[] = [];
  const incoming: object[] = [];
  const outgoing: object[] = [];
  for (const r of rows) {
    const otherId =
      r.requester_id === session.userId ? r.addressee_id : r.requester_id;
    const name = names.get(otherId) ?? "Unknown";
    if (r.status === "accepted") {
      const presence = presenceFor(otherId);
      friends.push({ userId: otherId, name, ...presence });
    } else if (r.addressee_id === session.userId) {
      incoming.push({ userId: otherId, name });
    } else {
      outgoing.push({ userId: otherId, name });
    }
  }
  res.json({ ok: true, friends, incoming, outgoing });
});

router.post("/api/friends/request", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const targetId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!isUserId(targetId) || targetId === session.userId)
    return res.status(400).json({ ok: false, reason: "Invalid target." });

  const { data: target } = await supabase
    .from("users")
    .select("id, display_name")
    .eq("id", targetId)
    .single();
  if (!target)
    return res.status(404).json({ ok: false, reason: "No such player." });

  const existing = await rowBetween(session.userId, targetId);
  if (existing) {
    // A pending request from the other side counts as mutual interest:
    // accept it instead of stacking a duplicate row.
    if (
      existing.status === "pending" &&
      existing.requester_id === targetId
    ) {
      const { error } = await supabase
        .from("friends")
        .update({ status: "accepted" })
        .eq("requester_id", targetId)
        .eq("addressee_id", session.userId);
      if (error) return res.status(500).json({ ok: false });
      void addNotification(
        targetId,
        "Friend request accepted",
        `${session.displayName} accepted your friend request.`,
      );
      return res.json({ ok: true, status: "friends" });
    }
    return res.json({
      ok: true,
      status: existing.status === "accepted" ? "friends" : "outgoing",
    });
  }

  const { error } = await supabase.from("friends").insert({
    requester_id: session.userId,
    addressee_id: targetId,
    status: "pending",
  });
  if (error) {
    console.error("[friends] request insert failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(
    targetId,
    "Friend request",
    `${session.displayName} wants to be your friend. Open your friends list (F) to accept.`,
  );
  res.json({ ok: true, status: "outgoing" });
});

router.post("/api/friends/accept", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const requesterId =
    typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!isUserId(requesterId)) return res.status(400).json({ ok: false });
  const { data, error } = await supabase
    .from("friends")
    .update({ status: "accepted" })
    .eq("requester_id", requesterId)
    .eq("addressee_id", session.userId)
    .eq("status", "pending")
    .select();
  if (error) {
    console.error("[friends] accept failed", error);
    return res.status(500).json({ ok: false });
  }
  if (!data || data.length === 0)
    return res.status(404).json({ ok: false, reason: "No pending request." });
  void addNotification(
    requesterId,
    "Friend request accepted",
    `${session.displayName} accepted your friend request.`,
  );
  res.json({ ok: true });
});

router.post("/api/friends/remove", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const otherId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!isUserId(otherId)) return res.status(400).json({ ok: false });
  const { error } = await supabase
    .from("friends")
    .delete()
    .or(
      `and(requester_id.eq.${orValue(session.userId)},addressee_id.eq.${orValue(otherId)}),` +
        `and(requester_id.eq.${orValue(otherId)},addressee_id.eq.${orValue(session.userId)})`,
    );
  if (error) {
    console.error("[friends] remove failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

router.get("/api/players/search", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const q = (typeof req.query.q === "string" ? req.query.q : "").trim();
  if (q.length < 2)
    return res.json({ ok: true, players: [] });

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name")
    .ilike("display_name", `%${q.replace(/[%_]/g, "")}%`)
    .neq("id", session.userId)
    .limit(10);
  if (error) {
    console.error("[friends] search failed", error);
    return res.status(500).json({ ok: false });
  }
  const players = (data ?? []).map((u) => ({
    userId: u.id as string,
    name: u.display_name as string,
    online: presenceFor(u.id as string).online,
  }));
  res.json({ ok: true, players });
});

router.get("/api/players/profile", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const targetId = typeof req.query.userId === "string" ? req.query.userId : "";
  if (!isUserId(targetId)) return res.status(400).json({ ok: false });
  const { data: user } = await supabase
    .from("users")
    .select("id, display_name, skin, created_at")
    .eq("id", targetId)
    .single();
  if (!user) return res.status(404).json({ ok: false });

  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", targetId);

  let friendStatus = "none";
  if (targetId !== session.userId) {
    const row = await rowBetween(session.userId, targetId);
    if (row) {
      friendStatus =
        row.status === "accepted"
          ? "friends"
          : row.requester_id === session.userId
            ? "outgoing"
            : "incoming";
    }
  } else {
    friendStatus = "self";
  }

  res.json({
    ok: true,
    userId: user.id,
    name: user.display_name,
    skin: user.skin ?? "cvc:1",
    createdAt: user.created_at,
    projects: count ?? 0,
    friendStatus,
    online: presenceFor(targetId).online,
  });
});

export default router;
