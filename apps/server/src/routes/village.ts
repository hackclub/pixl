import { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { addNotification } from "./notifications.js";
import { presenceFor, sendToUser } from "../ws/gameServer.js";
import { areFriends } from "../social.js";
import { lobbies } from "../ws/lobbies.js";

const router = Router();

interface InviteRow {
  id: number;
  lobby_id: string;
  lobby_name: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  created_at: string;
  expires_at: string;
}

async function nameFor(userId: string): Promise<string> {
  const { data } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", userId)
    .single();
  return (data?.display_name as string) ?? "Someone";
}

// Invite a friend into the village you're currently standing in. Requires you
// to actually be inside a lobby (any member can invite, not just the owner) and
// to be accepted friends with the target. Persists a pending invite so the
// friend can accept later while the village still exists, pings their inbox,
// and, if they're online, pushes a live prompt over the game socket.
router.post("/api/village/invite", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const targetId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!targetId || targetId === session.userId)
    return res.status(400).json({ ok: false, reason: "Invalid target." });

  const me = presenceFor(session.userId);
  if (!me.lobbyId)
    return res
      .status(400)
      .json({ ok: false, reason: "You have to be in a village to invite someone." });
  const lobby = lobbies.get(me.lobbyId);
  if (!lobby)
    return res
      .status(400)
      .json({ ok: false, reason: "You have to be in a village to invite someone." });

  if (!(await areFriends(session.userId, targetId)))
    return res
      .status(403)
      .json({ ok: false, reason: "You can only invite your friends." });

  const theirPresence = presenceFor(targetId);
  if (theirPresence.lobbyId === lobby.id)
    return res.json({ ok: true, status: "already_here" });

  // Collapse repeat clicks: reuse a live pending invite to the same village.
  const { data: existing } = await supabase
    .from("village_invites")
    .select("id")
    .eq("lobby_id", lobby.id)
    .eq("to_user_id", targetId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if ((existing ?? []).length > 0)
    return res.json({ ok: true, status: "pending" });

  const { data: inserted, error } = await supabase
    .from("village_invites")
    .insert({
      lobby_id: lobby.id,
      lobby_name: lobby.name,
      from_user_id: session.userId,
      to_user_id: targetId,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("[village] invite insert failed", error);
    return res.status(500).json({ ok: false });
  }

  void addNotification(
    targetId,
    "Village invite",
    `${session.displayName} invited you to ${lobby.name}. Open your friends list (F) to join.`,
  );
  sendToUser(targetId, {
    type: "village_invited",
    inviteId: inserted.id,
    fromName: session.displayName,
    lobbyId: lobby.id,
    lobbyName: lobby.name,
  });

  res.json({ ok: true, status: "sent" });
});

// A player's live incoming invites, newest first. Skips any whose village has
// since disappeared so the list only ever shows villages you can actually join.
router.get("/api/village/invites", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const { data, error } = await supabase
    .from("village_invites")
    .select("*")
    .eq("to_user_id", session.userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[village] invite list failed", error);
    return res.status(500).json({ ok: false });
  }

  const rows = (data ?? []) as InviteRow[];
  const invites: object[] = [];
  for (const r of rows) {
    const lobby = lobbies.get(r.lobby_id);
    if (!lobby) continue;
    invites.push({
      id: r.id,
      lobbyId: r.lobby_id,
      lobbyName: lobby.name,
      fromName: await nameFor(r.from_user_id),
    });
  }
  res.json({ ok: true, invites });
});

// Turn down an invite. Scoped to the recipient so you can only decline your own.
router.post("/api/village/invite/decline", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const session = token ? verifySessionToken(token) : null;
  if (!session) return res.status(401).json({ ok: false });

  const inviteId = Number(req.body?.inviteId ?? 0);
  if (!inviteId)
    return res.status(400).json({ ok: false, reason: "Invalid invite." });

  const { error } = await supabase
    .from("village_invites")
    .update({ status: "declined" })
    .eq("id", inviteId)
    .eq("to_user_id", session.userId)
    .eq("status", "pending");
  if (error) {
    console.error("[village] invite decline failed", error);
    return res.status(500).json({ ok: false });
  }
  res.json({ ok: true });
});

export default router;
