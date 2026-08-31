import { randomInt } from "node:crypto";
import { supabase } from "../db/client.js";

export interface Lobby {
  id: string;
  name: string;
  isPublic: boolean;
  password: string;
  capacity: number;
  ownerId: string;
  createdAt: number;
  theme: string;
  themesUnlocked: Set<string>;
}

export interface LobbyInfo {
  id: string;
  name: string;
  isPublic: boolean;
  count: number;
  capacity: number;
  theme: string;
  mine?: boolean;
  password?: string;
  themesUnlocked?: string[];
}

export const LOBBY_SCENE_PREFIX = "lobby:";
export const LOBBY_CAPACITY = 16;
const MAX_LOBBIES = 200;

// Cosmetic village themes — the first village upgrade. Each is a tint the whole
// village sees; it composes with the day/night cycle client-side (the client
// holds the matching colours). '' is the always-owned default (no tint).
export const VILLAGE_THEMES: Record<string, { name: string; price: number }> = {
  autumn: { name: "Autumn", price: 500 },
  blossom: { name: "Blossom", price: 500 },
  verdant: { name: "Verdant", price: 500 },
  dusk: { name: "Dusk", price: 750 },
};

export function themePrice(id: string): number {
  return VILLAGE_THEMES[id]?.price ?? 0;
}

export const lobbies = new Map<string, Lobby>();

export function lobbyIdFromScene(scene: string): string | null {
  if (!scene.startsWith(LOBBY_SCENE_PREFIX)) return null;
  const id = scene.slice(LOBBY_SCENE_PREFIX.length);
  return id || null;
}

export function lobbyScene(id: string): string {
  return LOBBY_SCENE_PREFIX + id;
}

export async function loadLobbies() {
  const { data, error } = await supabase.from("lobbies").select("*");
  if (error) {
    console.error("Failed to load lobbies (is the lobbies table migrated?)", error);
    return;
  }
  for (const r of data ?? []) {
    lobbies.set(r.id as string, {
      id: r.id as string,
      name: r.name as string,
      isPublic: !!r.is_public,
      password: (r.password as string) ?? "",
      capacity: LOBBY_CAPACITY,
      ownerId: (r.owner_id as string) ?? "",
      createdAt: Date.parse(r.created_at as string) || Date.now(),
      theme: (r.theme as string) ?? "",
      themesUnlocked: new Set<string>(),
    });
  }

  // Fold permanent unlocks into each lobby so the owner's picker knows what's
  // already bought without a per-lobby round trip.
  const { data: upgrades, error: upgradeError } = await supabase
    .from("village_upgrades")
    .select("lobby_id, upgrade_key");
  if (upgradeError) {
    console.error("Failed to load village upgrades", upgradeError);
  } else {
    for (const u of upgrades ?? []) {
      lobbies.get(u.lobby_id as string)?.themesUnlocked.add(u.upgrade_key as string);
    }
  }
  console.log(`[lobbies] loaded ${lobbies.size} persisted lobbies`);
}

function persistLobby(l: Lobby) {
  if (!l.ownerId) return;
  void supabase
    .from("lobbies")
    .upsert({
      id: l.id,
      name: l.name,
      is_public: l.isPublic,
      password: l.password,
      owner_id: l.ownerId,
      created_at: new Date(l.createdAt).toISOString(),
      theme: l.theme,
    })
    .then(({ error }) => {
      if (error) console.error("Failed to persist lobby", error);
    });
}

function gen4DigitPassword(): string {
  return randomInt(1000, 10000).toString();
}

function genLobbyCode(len = 5): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code: string;
  do {
    code = "";
    for (let i = 0; i < len; i++) code += alphabet[randomInt(alphabet.length)];
  } while (lobbies.has(code));
  return code;
}

export function createLobby(opts: {
  isPublic: boolean;
  name?: string;
  ownerId: string;
}): Lobby | null {
  if (lobbies.size >= MAX_LOBBIES) return null;
  const id = genLobbyCode();
  const name =
    (typeof opts.name === "string" ? opts.name.trim().slice(0, 30) : "") ||
    (opts.isPublic ? `Lobby ${id}` : `Private ${id}`);
  const lobby: Lobby = {
    id,
    name,
    isPublic: opts.isPublic,
    password: opts.isPublic ? "" : gen4DigitPassword(),
    capacity: LOBBY_CAPACITY,
    ownerId: opts.ownerId,
    createdAt: Date.now(),
    theme: "",
    themesUnlocked: new Set<string>(),
  };
  lobbies.set(id, lobby);
  persistLobby(lobby);
  return lobby;
}

export function renameLobby(l: Lobby, name: string) {
  const clean = name.trim().slice(0, 30);
  if (clean) l.name = clean;
  persistLobby(l);
}

export function setLobbyVisibility(l: Lobby, isPublic: boolean) {
  l.isPublic = isPublic;
  l.password = isPublic ? "" : l.password || gen4DigitPassword();
  persistLobby(l);
}

// Apply an already-owned theme (or clear it with ''). Buying an unlock is
// separate — this only swaps between what the village already owns.
export function setLobbyTheme(l: Lobby, theme: string): boolean {
  if (theme !== "" && !l.themesUnlocked.has(theme)) return false;
  l.theme = theme;
  persistLobby(l);
  return true;
}

export function deleteLobby(id: string) {
  if (!lobbies.delete(id)) return;
  void supabase
    .from("lobbies")
    .delete()
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("Failed to delete lobby", error);
    });
}

export function lobbyInfoFor(
  l: Lobby,
  count: number,
  userId: string,
): LobbyInfo {
  const info: LobbyInfo = {
    id: l.id,
    name: l.name,
    isPublic: l.isPublic,
    count,
    capacity: l.capacity,
    theme: l.theme,
  };
  if (l.ownerId && l.ownerId === userId) {
    info.mine = true;
    info.themesUnlocked = [...l.themesUnlocked];
    if (!l.isPublic) info.password = l.password;
  }
  return info;
}
