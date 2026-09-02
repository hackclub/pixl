import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { verifySessionToken } from "../auth/session.js";
import { activeBan, censorChat, recordChatViolation } from "../moderation.js";
import { areFriends } from "../social.js";
import { getPixoChatReply } from "../pixoChat.js";
import { supabase, type PlayerStateRow } from "../db/client.js";
import {
  type Lobby,
  lobbies,
  lobbyIdFromScene,
  lobbyScene,
  loadLobbies,
  createLobby,
  renameLobby,
  setLobbyVisibility,
  setLobbyTheme,
  deleteLobby,
  lobbyInfoFor,
  VILLAGE_THEMES,
  themePrice,
} from "./lobbies.js";

interface ConnectedPlayer {
  ws: WebSocket;
  userId: string;
  displayName: string;
  scene: string;
  posX: number;
  posY: number;
  direction: string;
  skin: string;
  lastSaved: number;
  lastMoveAt: number;
  changingScene: boolean;
  lobbyGrant: string;
  blocked: Set<string>;
  msgTimestamps: number[];
}

// Client sprint speed tops out around 200px/s (see apps/game/scripts/player.gd).
// This is a generous multiple of that so normal play, batched frames, and
// network jitter never trip it, it only rejects the kind of instant,
// unbounded jump a modified/scripted client sends.
const MAX_MOVE_SPEED_PX_PER_SEC = 600;
const MOVE_SLACK_PX = 200;

// Per-connection inbound message throttle. Legit play sends move updates at
// most a few dozen times a second; this caps the fan-out/parse cost a single
// abusive or malfunctioning client can put on everyone else in its scene.
const MSG_WINDOW_MS = 1000;
const MSG_MAX_PER_WINDOW = 60;

const SKIN_RE = /^(cvc:[1-9]|cv1:b[1-3]h(\d|1[0-8])t([1-9]|1[0-8])o([1-9]|1[0-8]))$/;

const EMOTE_KEYS = new Set([
  "happy", "laugh", "heart", "sad", "angry", "love", "cry", "idea",
  "music", "sleep", "star", "question", "alert", "exclaim", "dizzy",
]);

const players = new Map<string, ConnectedPlayer>();

// Per-player cooldown on /pixo, keyed by userId, storing the ms timestamp
// they're next allowed to use it again. Bounds OpenRouter cost/abuse; a
// single in-memory map is fine since this only has to survive one process.
const PIXO_COOLDOWN_MS = 8000;
const pixoCooldowns = new Map<string, number>();

// The village is a private, per-player space: everyone requests the scene
// "village", but each player gets their own room so they don't share it.
// Other scenes (openworld, house_interior) stay shared. Lobby scenes
// ("lobby:<CODE>") are shared rooms scoped to one lobby instance.
function roomFor(userId: string, scene: string): string {
  return scene === "village" ? `village:${userId}` : scene;
}

function lobbyMemberCount(id: string, exceptUserId?: string): number {
  const room = lobbyScene(id);
  let n = 0;
  for (const [uid, p] of players) {
    if (uid === exceptUserId) continue;
    if (p.scene === room) n++;
  }
  return n;
}

function lobbyJoinError(
  l: Lobby | undefined,
  userId: string,
  password: string,
): string | null {
  if (!l) return "That lobby doesn't exist.";
  if (lobbyMemberCount(l.id, userId) >= l.capacity) return "That lobby is full.";
  if (!l.isPublic && l.ownerId !== userId && password !== l.password)
    return "Wrong password.";
  return null;
}

function pickPublicLobby(): Lobby | null {
  let best: Lobby | null = null;
  let bestCount = -1;
  for (const l of lobbies.values()) {
    if (!l.isPublic) continue;
    const c = lobbyMemberCount(l.id);
    if (c < l.capacity && c > bestCount) {
      best = l;
      bestCount = c;
    }
  }
  return best ?? createLobby({ isPublic: true, ownerId: "" });
}

const EMPTY_SYSTEM_LOBBY_GRACE_MS = 3 * 60_000;

// pickPublicLobby() auto-creates ownerless "system" lobbies when no public
// lobby has room. Nobody can ever manage/delete one of those (the owner
// check in lobby_manage requires a real ownerId), so left alone they
// accumulate forever and eventually exhaust MAX_LOBBIES for everyone. Reap
// any that are still empty after a grace period long enough for the player
// who triggered the quick-join to actually walk in.
function sweepEmptySystemLobbies() {
  const now = Date.now();
  for (const l of lobbies.values()) {
    if (l.ownerId) continue;
    if (now - l.createdAt < EMPTY_SYSTEM_LOBBY_GRACE_MS) continue;
    if (lobbyMemberCount(l.id) > 0) continue;
    deleteLobby(l.id);
  }
}

function lobbyListFor(userId: string) {
  return [...lobbies.values()].map((l) =>
    lobbyInfoFor(l, lobbyMemberCount(l.id), userId),
  );
}

function closeLobby(id: string) {
  deleteLobby(id);
  const room = lobbyScene(id);
  const payload = JSON.stringify({
    type: "lobby_closed",
    reason: "This lobby was closed by its owner.",
  });
  for (const p of players.values()) {
    if (p.scene === room && p.ws.readyState === WebSocket.OPEN)
      p.ws.send(payload);
  }
}

const SAVE_INTERVAL_MS = 5000;

// Images are not allowed in chat/DMs, strip [img]…[/img] server-side so they
// never broadcast, store, or reach any client.
const IMG_TAG_RE = /\[img\b[^\]]*\][\s\S]*?\[\/img\]/gi;

function broadcastToScene(
  scene: string,
  message: object,
  exceptUserId?: string,
) {
  const payload = JSON.stringify(message);
  for (const [userId, p] of players) {
    if (userId === exceptUserId) continue;
    if (p.scene !== scene) continue;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}

function snapshotForScene(scene: string, exceptUserId?: string) {
  return Array.from(players.values())
    .filter((p) => p.scene === scene && p.userId !== exceptUserId)
    .map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      posX: p.posX,
      posY: p.posY,
      direction: p.direction,
      skin: p.skin,
    }));
}

// Position is now stored per (user, scene), so saving upserts the row for the
// player's *current* scene rather than overwriting a single global position.
async function persist(p: ConnectedPlayer) {
  const { error } = await supabase
    .from("player_state")
    .upsert(
      {
        user_id: p.userId,
        scene: p.scene,
        pos_x: p.posX,
        pos_y: p.posY,
        direction: p.direction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,scene" },
    );

  if (error) console.error("Failed to persist player_state", error);
}

// Loads the saved position for one specific scene, or null if the player has
// never been there before (caller then spawns them at the scene's default).
async function loadSceneState(
  userId: string,
  scene: string,
): Promise<PlayerStateRow | null> {
  const { data, error } = await supabase
    .from("player_state")
    .select("*")
    .eq("user_id", userId)
    .eq("scene", scene)
    .limit(1);

  if (error) console.error("Failed to load scene state", error);
  return (data && (data[0] as PlayerStateRow)) ?? null;
}

// NPCs only live in the village, which is a private per-player room. Strip the
// `:userId` suffix so NPC rows key off the base scene name the client uses.
function baseSceneName(room: string): string {
  if (room.startsWith("village:")) return "village";
  if (lobbyIdFromScene(room)) return "open_world";
  return room;
}

// Tells a client entering a lobby scene which cosmetic theme the village is
// wearing, so every entry path (fresh connect, cross-scene walk, reconnect)
// applies the tint without depending on the lobby_joined reply.
function sendLobbyTheme(p: ConnectedPlayer) {
  const lid = lobbyIdFromScene(p.scene);
  const lobby = lid ? lobbies.get(lid) : undefined;
  if (!lobby || p.ws.readyState !== WebSocket.OPEN) return;
  p.ws.send(JSON.stringify({ type: "lobby_theme", theme: lobby.theme }));
}

// Sends the player their saved NPC positions for a scene so the client can
// place villagers where they last left them (empty list on a first visit).
async function sendNpcInit(p: ConnectedPlayer, scene: string) {
  const { data, error } = await supabase
    .from("npc_state")
    .select("npc_id,pos_x,pos_y")
    .eq("user_id", p.userId)
    .eq("scene", scene);

  if (error) console.error("Failed to load npc_state", error);
  if (p.ws.readyState !== WebSocket.OPEN) return;

  p.ws.send(
    JSON.stringify({
      type: "npc_init",
      scene,
      npcs: (data ?? []).map((r) => ({
        id: r.npc_id,
        posX: r.pos_x,
        posY: r.pos_y,
      })),
    }),
  );
}

// Upserts the positions the client reports for its NPCs in a scene.
async function persistNpcs(
  userId: string,
  scene: string,
  list: Array<{ id: unknown; posX: unknown; posY: unknown }>,
) {
  const rows = [];
  for (const n of list) {
    const id = String(n.id ?? "").slice(0, 64);
    const px = Number(n.posX);
    const py = Number(n.posY);
    if (!id || !Number.isFinite(px) || !Number.isFinite(py)) continue;
    rows.push({
      user_id: userId,
      scene,
      npc_id: id,
      pos_x: px,
      pos_y: py,
      updated_at: new Date().toISOString(),
    });
  }
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("npc_state")
    .upsert(rows, { onConflict: "user_id,scene,npc_id" });
  if (error) console.error("Failed to persist npc_state", error);
}

// Presence snapshot for the HTTP routes (friends list, profiles). Lobby id is
// only exposed for players currently inside a lobby scene.
export function presenceFor(userId: string): {
  online: boolean;
  lobbyId: string;
  lobbyName: string;
} {
  const p = players.get(userId);
  if (!p) return { online: false, lobbyId: "", lobbyName: "" };
  const lid = lobbyIdFromScene(p.scene);
  const lobby = lid ? lobbies.get(lid) : undefined;
  return {
    online: true,
    lobbyId: lobby ? lobby.id : "",
    lobbyName: lobby ? lobby.name : "",
  };
}

export function listOnlinePlayers(): {
  userId: string;
  displayName: string;
  scene: string;
  skin: string;
}[] {
  return [...players.values()].map((p) => ({
    userId: p.userId,
    displayName: p.displayName,
    scene: p.scene,
    skin: p.skin,
  }));
}

// Push a one-off frame to a specific player's socket if they're connected.
// Returns whether it was delivered, callers (e.g. village invites) fall back
// to the inbox for offline players. Best-effort: never throws.
export function sendToUser(userId: string, payload: unknown): boolean {
  const p = players.get(userId);
  if (!p || p.ws.readyState !== WebSocket.OPEN) return false;
  try {
    p.ws.send(JSON.stringify(payload));
    return true;
  } catch (e) {
    console.error("sendToUser failed", e);
    return false;
  }
}

// Filter hit: log it, warn from the 3rd violation, auto-ban at the 7th.
async function punishChat(
  player: ConnectedPlayer,
  ws: WebSocket,
  raw: string,
): Promise<void> {
  try {
    const outcome = await recordChatViolation(player.userId, raw);
    if (outcome.banned) {
      kickPlayer(
        player.userId,
        "Banned automatically after repeated chat violations.",
      );
      return;
    }
    if (outcome.warned && ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          type: "chat",
          userId: "__pixl__",
          displayName: "Pixl",
          text: `⚠ Warning ${outcome.count}/7: keep the chat clean. 7 violations = automatic ban.`,
        }),
      );
  } catch (e) {
    console.error("punishChat failed", e);
  }
}

export function kickPlayer(userId: string, reason: string): boolean {
  const p = players.get(userId);
  if (!p) return false;
  p.ws.close(4003, (reason || "You were kicked by a moderator.").slice(0, 120));
  return true;
}

const BAN_SWEEP_MS = 30_000;

// Dashboard bans land directly in the bans table, so poll it to kick
// players who are banned while already connected.
async function sweepBans() {
  if (players.size === 0) return;
  const { data, error } = await supabase
    .from("bans")
    .select("user_id, expires_at")
    .in("user_id", [...players.keys()])
    .is("lifted_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) {
    console.error("Failed to sweep bans", error);
    return;
  }
  for (const row of data ?? []) {
    const p = players.get(row.user_id as string);
    if (!p) continue;
    const message = row.expires_at
      ? `You've been temporarily banned from Pixl until ${new Date(row.expires_at as string).toUTCString()}.`
      : "You've been permanently banned from Pixl.";
    console.log("Kicking banned player", p.userId, message);
    p.ws.close(4003, message.slice(0, 120));
  }
}

// Cap on new /ws connection attempts per IP. This is enforced on the raw
// 'upgrade' event because a WebSocketServer bound with { server } attaches
// straight to http.Server's upgrade event, which never passes through
// Express, the app-level rate limiter in index.ts never sees this traffic.
const UPGRADE_WINDOW_MS = 60_000;
const UPGRADE_MAX_PER_WINDOW = 30;
const upgradeAttempts = new Map<string, number[]>();

// Mirrors the Express `trust proxy: 1` setting in index.ts, this handler
// runs on the raw http.Server 'upgrade' event, outside Express, so req.ip
// isn't available. With exactly one trusted hop (the platform's edge/ingress
// proxy) in front of us, the rightmost X-Forwarded-For entry is the address
// that proxy actually saw; req.socket.remoteAddress alone would be the
// proxy's own shared IP, and trusting the client-suppliable leftmost entry
// would let anyone rotate it to dodge the limit entirely.
function upgradeClientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  if (raw) {
    const parts = raw.split(",").map((p) => p.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function upgradeRateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (upgradeAttempts.get(ip) ?? []).filter(
    (t) => now - t < UPGRADE_WINDOW_MS,
  );
  arr.push(now);
  upgradeAttempts.set(ip, arr);
  return arr.length > UPGRADE_MAX_PER_WINDOW;
}

export function attachWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const ip = upgradeClientIp(req);
    if (upgradeRateLimited(ip)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  void loadLobbies();
  setInterval(() => void sweepBans(), BAN_SWEEP_MS);
  setInterval(sweepEmptySystemLobbies, EMPTY_SYSTEM_LOBBY_GRACE_MS);

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { isAlive?: boolean };
      if (w.isAlive === false) {
        w.terminate();
        continue;
      }
      w.isAlive = false;
      w.ping();
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeatInterval));

  wss.on("connection", (ws, req) => {
    console.log("New WS connection attempt from", req.socket.remoteAddress);
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    const session = token ? verifySessionToken(token) : null;

    if (!session) {
      console.log("Connection rejected: invalid/missing token");
      ws.close(4001, "Unauthorized");
      return;
    }

    console.log(
      "Connection authorized for userId:",
      session.userId,
      "name:",
      session.displayName,
    );

    let player: ConnectedPlayer | null = null;

    (async () => {
      const ban = await activeBan(session.userId);
      if (ban) {
        const message = ban.expires_at
          ? `You've been temporarily banned from Pixl until ${new Date(ban.expires_at).toUTCString()}.`
          : "You've been permanently banned from Pixl.";
        console.log("Connection rejected: banned", session.userId, message);
        ws.close(4003, message.slice(0, 120));
        return;
      }

      // Default to the player's most recently active scene/position.
      const { data: stateRows, error } = await supabase
        .from("player_state")
        .select("*")
        .eq("user_id", session.userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (error) console.error("Failed to load player_state", error);

      const state = (stateRows && stateRows[0]) as PlayerStateRow | undefined;

      // Pull the player's chosen skin descriptor (defaults handled by the DB).
      const { data: userRow } = await supabase
        .from("users")
        .select("skin")
        .eq("id", session.userId)
        .single();

      let startState: PlayerStateRow | undefined | null = state;
      let startScene = state?.scene ?? "village";
      const savedLobbyId = lobbyIdFromScene(startScene);
      let lobbyGrant = "";
      if (savedLobbyId) {
        const l = lobbies.get(savedLobbyId);
        if (!l || lobbyMemberCount(savedLobbyId, session.userId) >= l.capacity) {
          startScene = "village";
          startState = await loadSceneState(
            session.userId,
            roomFor(session.userId, "village"),
          );
        } else {
          lobbyGrant = savedLobbyId;
        }
      }

      const { data: blockRows } = await supabase
        .from("blocks")
        .select("blocked_id")
        .eq("blocker_id", session.userId);
      const blocked = new Set<string>((blockRows ?? []).map((r) => r.blocked_id as string));

      player = {
        ws,
        userId: session.userId,
        displayName: session.displayName,
        scene: roomFor(session.userId, startScene),
        posX: startState?.pos_x ?? 0,
        posY: startState?.pos_y ?? 0,
        direction: startState?.direction ?? "bottom",
        skin: (userRow as { skin?: string } | null)?.skin ?? "cvc:1",
        lastSaved: Date.now(),
        lastMoveAt: Date.now(),
        changingScene: false,
        lobbyGrant,
        blocked,
        msgTimestamps: [],
      };
      const stale = players.get(session.userId);
      if (stale && stale.ws !== ws) {
        players.delete(session.userId);
        broadcastToScene(stale.scene, {
          type: "player_left",
          userId: stale.userId,
        });
        if (
          stale.ws.readyState === WebSocket.OPEN ||
          stale.ws.readyState === WebSocket.CONNECTING
        ) {
          stale.ws.close(4002, "Replaced by a newer connection");
        }
      }
      players.set(session.userId, player);
      ws.send(JSON.stringify({ type: "blocks", ids: [...player.blocked] }));

      console.log(
        "Player registered. Scene:",
        player.scene,
        "| All active players:",
        Array.from(players.values()).map((p) => `${p.displayName}(${p.scene})`),
      );

      ws.send(
        JSON.stringify({
          type: "init",
          scene: player.scene,
          you: {
            userId: player.userId,
            displayName: player.displayName,
            posX: player.posX,
            posY: player.posY,
            skin: player.skin,
          },
          players: snapshotForScene(player.scene, player.userId),
        }),
      );

      void sendNpcInit(player, baseSceneName(player.scene));
      sendLobbyTheme(player);

      broadcastToScene(
        player.scene,
        {
          type: "player_joined",
          userId: player.userId,
          displayName: player.displayName,
          posX: player.posX,
          posY: player.posY,
          direction: player.direction,
          skin: player.skin,
        },
        player.userId,
      );
    })();

    ws.on("message", (raw, isBinary) => {
      if (!player) return;
      if (players.get(player.userId) !== player) return;

      // Voice chat was removed; ignore any stray binary frames.
      if (isBinary) return;

      const now0 = Date.now();
      player.msgTimestamps = player.msgTimestamps.filter(
        (t) => now0 - t < MSG_WINDOW_MS,
      );
      if (player.msgTimestamps.length >= MSG_MAX_PER_WINDOW) return;
      player.msgTimestamps.push(now0);

      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "move") {
        const posX = Number(msg.posX);
        const posY = Number(msg.posY);
        const direction =
          typeof msg.direction === "string"
            ? msg.direction.slice(0, 16)
            : player.direction;

        // Reject anything that isn't a real, finite coordinate outright, a
        // client sending a string/object/NaN here would otherwise get
        // broadcast verbatim to every other player in the scene and
        // persisted into player_state.
        if (!Number.isFinite(posX) || !Number.isFinite(posY)) return;

        const now = Date.now();
        const elapsedSec = Math.max((now - player.lastMoveAt) / 1000, 0);
        const maxDist = MAX_MOVE_SPEED_PX_PER_SEC * elapsedSec + MOVE_SLACK_PX;
        const dist = Math.hypot(posX - player.posX, posY - player.posY);
        player.lastMoveAt = now;

        if (dist > maxDist) {
          // Refuse the jump and snap the client back to where the server
          // still thinks it is, instead of accepting a teleport/speed-hack.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "position_correction",
                posX: player.posX,
                posY: player.posY,
              }),
            );
          }
          return;
        }

        player.posX = posX;
        player.posY = posY;
        player.direction = direction;

        broadcastToScene(
          player.scene,
          {
            type: "player_moved",
            userId: player.userId,
            posX: player.posX,
            posY: player.posY,
            direction: player.direction,
          },
          player.userId,
        );

        if (now - player.lastSaved > SAVE_INTERVAL_MS) {
          player.lastSaved = now;
          persist(player).catch(console.error);
        }
      }

      if (msg.type === "change_scene") {
        // Two change_scene messages in flight for the same connection race:
        // the second one's async continuation can read/broadcast against
        // player.scene before the first has finished updating it, producing
        // a "ghost" player_joined in one scene with no matching player_left.
        // Serialize them per-connection instead.
        if (player.changingScene) return;
        const leaving = player;
        leaving.changingScene = true;
        const oldScene = leaving.scene;
        let requested = String(msg.scene ?? "");

        const targetLobbyId = lobbyIdFromScene(requested);
        if (targetLobbyId) {
          const l = lobbies.get(targetLobbyId);
          const granted =
            l &&
            (l.isPublic ||
              l.ownerId === leaving.userId ||
              leaving.lobbyGrant === targetLobbyId);
          const full =
            l && lobbyMemberCount(targetLobbyId, leaving.userId) >= l.capacity;
          if (!l || !granted || full) {
            ws.send(
              JSON.stringify({
                type: "lobby_denied",
                reason: !l
                  ? "That lobby no longer exists."
                  : full
                    ? "That lobby is full."
                    : "You need the lobby's password to enter.",
              }),
            );
            requested = "open_world";
          }
        }

        const newScene = roomFor(leaving.userId, requested);

        void (async () => {
          try {
            // Save where the player was standing in the scene they're leaving so
            // it's there when they come back. persist() snapshots the row
            // synchronously, so it's safe to let the upsert finish in the
            // background instead of stalling the init reply on a DB round-trip.
            void persist(leaving);

            broadcastToScene(
              oldScene,
              { type: "player_left", userId: leaving.userId },
              leaving.userId,
            );

            // Move into the new scene at its own saved position. If there's no
            // saved position yet, tell the client to use the scene's spawn point.
            // Re-entering the same scene skips the DB read, the in-memory
            // position is already the latest.
            const saved: Pick<PlayerStateRow, "pos_x" | "pos_y" | "direction"> | null =
              oldScene === newScene
                ? { pos_x: leaving.posX, pos_y: leaving.posY, direction: leaving.direction }
                : await loadSceneState(leaving.userId, newScene);
            leaving.scene = newScene;
            let spawnAtDefault = false;
            if (saved) {
              leaving.posX = saved.pos_x;
              leaving.posY = saved.pos_y;
              leaving.direction = saved.direction;
            } else {
              spawnAtDefault = true;
              leaving.direction = "bottom";
            }
            // The new scene is a different coordinate space entirely, so the
            // move anti-cheat shouldn't compare the next move against where
            // the player was standing in the old one.
            leaving.lastMoveAt = Date.now();

            console.log(
              leaving.displayName,
              "changed scene:",
              oldScene,
              "->",
              newScene,
              spawnAtDefault ? "(default spawn)" : "(restored position)",
              "| players now in",
              newScene,
              ":",
              snapshotForScene(newScene).map((p) => p.displayName),
            );

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "init",
                  scene: newScene,
                  you: {
                    userId: leaving.userId,
                    displayName: leaving.displayName,
                    posX: leaving.posX,
                    posY: leaving.posY,
                    skin: leaving.skin,
                  },
                  spawnAtDefault,
                  players: snapshotForScene(newScene, leaving.userId),
                }),
              );
            }

            void sendNpcInit(leaving, baseSceneName(newScene));
            sendLobbyTheme(leaving);

            broadcastToScene(
              newScene,
              {
                type: "player_joined",
                userId: leaving.userId,
                displayName: leaving.displayName,
                posX: leaving.posX,
                posY: leaving.posY,
                direction: leaving.direction,
                skin: leaving.skin,
              },
              leaving.userId,
            );
          } finally {
            leaving.changingScene = false;
          }
        })().catch(console.error);
      }

      if (msg.type === "set_skin") {
        const skin = String(msg.skin ?? "");
        if (!SKIN_RE.test(skin)) return;
        player.skin = skin;

        // Persist the choice, then tell everyone in the scene (the sender
        // included) so all clients re-skin this player.
        void supabase
          .from("users")
          .update({ skin })
          .eq("id", player.userId)
          .then(({ error }) => {
            if (error) console.error("Failed to save skin", error);
          });

        broadcastToScene(player.scene, {
          type: "player_skin",
          userId: player.userId,
          skin,
        });
      }

      if (msg.type === "chat") {
        const raw = String(msg.text ?? "")
          .replace(IMG_TAG_RE, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 280);

        if (/^\/pixo(\s|$)/i.test(raw)) {
          const question = raw.replace(/^\/pixo\s*/i, "").trim();
          if (!question) {
            ws.send(JSON.stringify({ type: "dm_error", reason: "Usage: /pixo <question>, ask me anything about Pixl." }));
            return;
          }
          const now = Date.now();
          const readyAt = pixoCooldowns.get(player.userId) ?? 0;
          if (now < readyAt) {
            ws.send(
              JSON.stringify({
                type: "dm_error",
                reason: `Give me a sec, try /pixo again in ${Math.ceil((readyAt - now) / 1000)}s.`,
              }),
            );
            return;
          }
          pixoCooldowns.set(player.userId, now + PIXO_COOLDOWN_MS);
          const askingWs = ws;
          const askingId = player.userId;
          const askingName = player.displayName;
          void getPixoChatReply(question, askingName)
            .then((reply) => {
              if (askingWs.readyState !== WebSocket.OPEN) return;
              askingWs.send(
                JSON.stringify(
                  reply
                    ? { type: "dm", fromId: "pixo", fromName: "Pixo", toId: askingId, toName: askingName, text: reply }
                    : { type: "dm_error", reason: "Couldn't reach Pixo just now, try again in a bit." },
                ),
              );
            })
            .catch((e) => {
              console.error("pixo chat reply failed", e);
              if (askingWs.readyState === WebSocket.OPEN)
                askingWs.send(JSON.stringify({ type: "dm_error", reason: "Couldn't reach Pixo just now, try again in a bit." }));
            });
          return;
        }

        const text = censorChat(raw.slice(0, 200));
        if (text !== raw.slice(0, 200)) void punishChat(player, ws, raw.slice(0, 200));
        if (!text) return;

        void supabase
          .from("chat_messages")
          .insert({
            user_id: player.userId,
            display_name: player.displayName,
            scene: player.scene,
            text,
          })
          .then(({ error }) => {
            if (error) console.error("chat persist failed", error.message);
          });

        const chatFrame = JSON.stringify({
          type: "chat",
          userId: player.userId,
          displayName: player.displayName,
          text,
        });
        for (const [uid, p] of players) {
          if (p.scene !== player.scene) continue;
          // Don't deliver a sender's message to anyone who blocked them.
          if (uid !== player.userId && p.blocked.has(player.userId)) continue;
          if (p.ws.readyState === WebSocket.OPEN) p.ws.send(chatFrame);
        }
      }

      if (msg.type === "dm") {
        const targetName = String(msg.to ?? "").trim();
        const raw = String(msg.text ?? "")
          .replace(IMG_TAG_RE, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        if (!targetName || !raw) return;
        const text = censorChat(raw);
        if (text !== raw) void punishChat(player, ws, raw);

        // Prefer an exact userId match (unambiguous) so a future client can
        // route by id; fall back to case-insensitive display-name matching
        // for the current client, which only ever sends a name. Display
        // names aren't guaranteed unique (they come from Hack Club
        // Auth/Slack), so the fallback can still misdeliver on a collision,
        // routing by id is the real fix once the client sends one.
        let target: ConnectedPlayer | undefined = players.get(targetName);
        if (!target) {
          for (const p of players.values()) {
            if (p.displayName.toLowerCase() === targetName.toLowerCase()) {
              target = p;
              break;
            }
          }
        }
        if (!target) {
          ws.send(
            JSON.stringify({
              type: "dm_error",
              reason: `${targetName} isn't online.`,
            }),
          );
          return;
        }
        if (target.userId === player.userId) {
          ws.send(
            JSON.stringify({
              type: "dm_error",
              reason: "You can't whisper to yourself.",
            }),
          );
          return;
        }
        const frame = JSON.stringify({
          type: "dm",
          fromId: player.userId,
          fromName: player.displayName,
          toId: target.userId,
          toName: target.displayName,
          text,
        });
        // If the target blocked the sender, silently drop delivery (still echo
        // to the sender so the block isn't revealed).
        if (!target.blocked.has(player.userId) && target.ws.readyState === WebSocket.OPEN)
          target.ws.send(frame);
        ws.send(frame);
      }

      if (msg.type === "block" || msg.type === "unblock") {
        const targetId = String(msg.userId ?? "").trim();
        if (!targetId || targetId === player.userId) return;
        const self = player;
        const blocking = msg.type === "block";
        void (async () => {
          if (blocking) {
            await supabase
              .from("blocks")
              .upsert(
                { blocker_id: self.userId, blocked_id: targetId },
                { onConflict: "blocker_id,blocked_id" },
              );
            self.blocked.add(targetId);
          } else {
            await supabase
              .from("blocks")
              .delete()
              .eq("blocker_id", self.userId)
              .eq("blocked_id", targetId);
            self.blocked.delete(targetId);
          }
          if (self.ws.readyState === WebSocket.OPEN)
            self.ws.send(JSON.stringify({ type: "blocks", ids: [...self.blocked] }));
        })().catch(console.error);
      }

      if (msg.type === "lobby_join_friend") {
        const friendId = String(msg.userId ?? "");
        const asking = player;
        void (async () => {
          const friend = players.get(friendId);
          const lid = friend ? lobbyIdFromScene(friend.scene) : null;
          const lobby = lid ? lobbies.get(lid) : undefined;
          const deny = (reason: string) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "lobby_denied", reason }));
          };
          if (!friend) return deny("That friend isn't online right now.");
          if (!lid || !lobby)
            return deny("Your friend isn't in a lobby right now.");
          if (!(await areFriends(asking.userId, friendId)))
            return deny("You can only join lobbies of your friends.");
          if (lobbyMemberCount(lid, asking.userId) >= lobby.capacity)
            return deny("That lobby is full.");
          asking.lobbyGrant = lid;
          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                type: "lobby_joined",
                lobby: lobbyInfoFor(lobby, lobbyMemberCount(lid), asking.userId),
              }),
            );
        })().catch(console.error);
      }

      if (msg.type === "lobby_accept_invite") {
        const inviteId = Number(msg.inviteId ?? 0);
        const asking = player;
        void (async () => {
          const deny = (reason: string) => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "lobby_denied", reason }));
          };
          if (!inviteId) return deny("That invite is no longer valid.");
          const { data, error } = await supabase
            .from("village_invites")
            .select("*")
            .eq("id", inviteId)
            .limit(1);
          if (error) {
            console.error("[village] accept lookup failed", error);
            return deny("Couldn't reach the village right now.");
          }
          const invite = (data ?? [])[0] as
            | {
                lobby_id: string;
                to_user_id: string;
                status: string;
                expires_at: string;
              }
            | undefined;
          if (!invite || invite.to_user_id !== asking.userId)
            return deny("That invite is no longer valid.");
          if (invite.status !== "pending")
            return deny("You've already responded to that invite.");
          if (Date.parse(invite.expires_at) <= Date.now())
            return deny("That invite has expired.");
          const lobby = lobbies.get(invite.lobby_id);
          if (!lobby) return deny("That village no longer exists.");
          if (lobbyMemberCount(lobby.id, asking.userId) >= lobby.capacity)
            return deny("That village is full.");
          const { error: updateError } = await supabase
            .from("village_invites")
            .update({ status: "accepted" })
            .eq("id", inviteId)
            .eq("status", "pending");
          if (updateError) {
            console.error("[village] accept update failed", updateError);
            return deny("Couldn't reach the village right now.");
          }
          asking.lobbyGrant = lobby.id;
          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                type: "lobby_joined",
                lobby: lobbyInfoFor(
                  lobby,
                  lobbyMemberCount(lobby.id),
                  asking.userId,
                ),
              }),
            );
        })().catch(console.error);
      }

      if (msg.type === "emote") {
        const key = String(msg.key ?? "");
        if (!EMOTE_KEYS.has(key)) return;
        broadcastToScene(player.scene, {
          type: "emote",
          userId: player.userId,
          key,
        });
      }

      if (msg.type === "lobby_list") {
        ws.send(
          JSON.stringify({
            type: "lobby_list",
            lobbies: lobbyListFor(player.userId),
          }),
        );
      }

      if (msg.type === "lobby_create") {
        const lobby = createLobby({
          isPublic: !!msg.isPublic,
          name: typeof msg.name === "string" ? msg.name : "",
          ownerId: player.userId,
        });
        if (!lobby) {
          ws.send(
            JSON.stringify({
              type: "lobby_denied",
              reason: "Too many lobbies exist right now.",
            }),
          );
          return;
        }
        player.lobbyGrant = lobby.id;
        ws.send(
          JSON.stringify({
            type: "lobby_joined",
            lobby: lobbyInfoFor(lobby, 0, player.userId),
          }),
        );
      }

      if (msg.type === "lobby_join") {
        const id = String(msg.id ?? "").trim().toUpperCase();
        const password = String(msg.password ?? "").trim();
        const lobby = lobbies.get(id);
        const err = lobbyJoinError(lobby, player.userId, password);
        if (err || !lobby) {
          ws.send(
            JSON.stringify({
              type: "lobby_denied",
              reason: err ?? "That lobby doesn't exist.",
            }),
          );
          return;
        }
        player.lobbyGrant = id;
        const info = lobbyInfoFor(lobby, lobbyMemberCount(id), player.userId);
        if (!lobby.isPublic) info.password = lobby.password;
        ws.send(JSON.stringify({ type: "lobby_joined", lobby: info }));
      }

      if (msg.type === "lobby_quick_join") {
        const lobby = pickPublicLobby();
        if (!lobby) {
          ws.send(
            JSON.stringify({
              type: "lobby_denied",
              reason: "No lobbies are available right now.",
            }),
          );
          return;
        }
        player.lobbyGrant = lobby.id;
        ws.send(
          JSON.stringify({
            type: "lobby_joined",
            lobby: lobbyInfoFor(
              lobby,
              lobbyMemberCount(lobby.id),
              player.userId,
            ),
          }),
        );
      }

      if (msg.type === "lobby_manage") {
        const lobby = lobbies.get(String(msg.id ?? ""));
        if (!lobby || lobby.ownerId !== player.userId) {
          ws.send(
            JSON.stringify({
              type: "lobby_denied",
              reason: "That lobby isn't yours to manage.",
            }),
          );
          return;
        }
        const action = String(msg.action ?? "");
        if (action === "rename" && typeof msg.name === "string") {
          renameLobby(lobby, msg.name);
        } else if (action === "visibility") {
          setLobbyVisibility(lobby, !!msg.isPublic);
        } else if (action === "delete") {
          closeLobby(lobby.id);
        } else if (action === "theme") {
          const theme = String(msg.theme ?? "");
          if (!setLobbyTheme(lobby, theme)) {
            ws.send(
              JSON.stringify({
                type: "lobby_denied",
                reason: "Your village hasn't unlocked that theme yet.",
              }),
            );
            return;
          }
          // Everyone standing in the village updates live.
          broadcastToScene(lobbyScene(lobby.id), {
            type: "lobby_theme",
            theme: lobby.theme,
          });
        } else if (action === "buy_theme") {
          const theme = String(msg.theme ?? "");
          const price = themePrice(theme);
          if (!VILLAGE_THEMES[theme] || price <= 0) {
            ws.send(
              JSON.stringify({
                type: "lobby_denied",
                reason: "That theme isn't available.",
              }),
            );
            return;
          }
          void (async () => {
            const { data, error } = await supabase.rpc("buy_village_theme", {
              p_user_id: player.userId,
              p_lobby_id: lobby.id,
              p_theme: theme,
              p_price: price,
            });
            if (error) {
              console.error("[village] buy_village_theme failed", error);
              if (ws.readyState === WebSocket.OPEN)
                ws.send(
                  JSON.stringify({
                    type: "lobby_denied",
                    reason: "Couldn't complete that purchase.",
                  }),
                );
              return;
            }
            const result = data as { ok?: boolean; error?: string };
            if (!result?.ok) {
              const reason =
                result?.error === "insufficient"
                  ? "You don't have enough pixels for that theme."
                  : result?.error === "owned"
                    ? "Your village already owns that theme."
                    : "Couldn't complete that purchase.";
              if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: "lobby_denied", reason }));
              return;
            }
            lobby.themesUnlocked.add(theme);
            if (ws.readyState === WebSocket.OPEN)
              ws.send(
                JSON.stringify({
                  type: "lobby_list",
                  lobbies: lobbyListFor(player.userId),
                }),
              );
          })().catch(console.error);
          return;
        } else {
          return;
        }
        ws.send(
          JSON.stringify({
            type: "lobby_list",
            lobbies: lobbyListFor(player.userId),
          }),
        );
      }

      if (msg.type === "save_npcs") {
        const scene = baseSceneName(String(msg.scene ?? ""));
        const list = Array.isArray(msg.npcs) ? msg.npcs : [];
        if (!scene || list.length === 0 || list.length > 64) return;
        persistNpcs(player.userId, scene, list).catch(console.error);
      }
    });

    ws.on("close", () => {
      if (!player) return;
      if (players.get(player.userId) !== player) {
        console.log(player.displayName, "stale connection closed");
        return;
      }
      console.log(player.displayName, "disconnected from scene:", player.scene);
      players.delete(player.userId);
      persist(player).catch(console.error);
      broadcastToScene(player.scene, {
        type: "player_left",
        userId: player.userId,
      });
    });
  });

  return wss;
}
