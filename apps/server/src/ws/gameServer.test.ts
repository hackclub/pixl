import { describe, expect, test } from "bun:test";
import { consumeRateLimit } from "../rateLimit.js";
import { lobbyJoinError, LOBBY_JOIN_ATTEMPT_LIMIT, NPC_SAVE_LIMIT } from "./gameServer.js";
import type { Lobby } from "./lobbies.js";

function makeLobby(overrides: Partial<Lobby> = {}): Lobby {
  return {
    id: "ABCDE",
    name: "test lobby",
    isPublic: false,
    password: "1234",
    capacity: 16,
    ownerId: "owner-1",
    createdAt: Date.now(),
    theme: "",
    themesUnlocked: new Set(),
    ...overrides,
  };
}

describe("lobbyJoinError", () => {
  test("missing lobby is rejected", () => {
    expect(lobbyJoinError(undefined, "u1", "1234")).toBe("That lobby doesn't exist.");
  });

  test("public lobby needs no password", () => {
    const lobby = makeLobby({ isPublic: true, password: "" });
    expect(lobbyJoinError(lobby, "u1", "")).toBeNull();
  });

  test("owner joins their own private lobby without a password", () => {
    const lobby = makeLobby({ ownerId: "owner-1" });
    expect(lobbyJoinError(lobby, "owner-1", "wrong")).toBeNull();
  });

  test("correct password is accepted", () => {
    const lobby = makeLobby();
    expect(lobbyJoinError(lobby, "u1", "1234")).toBeNull();
  });

  test("wrong password is rejected", () => {
    const lobby = makeLobby();
    expect(lobbyJoinError(lobby, "u1", "0000")).toBe("Wrong password.");
  });
});

describe("lobby join brute-force limiting", () => {
  // gameServer.ts only calls consumeRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, userId)
  // when a private lobby's non-owner password check actually fails - this
  // exercises that same primitive with the real configured limit, proving a
  // 4-digit lobby password (10,000 possibilities) can no longer be brute
  // forced by unlimited guesses on one connection.
  test("wrong-password attempts are capped, not unlimited", () => {
    const userId = `brute-force-test-${Date.now()}`;
    let blockedAt = -1;
    for (let attempt = 1; attempt <= LOBBY_JOIN_ATTEMPT_LIMIT.max + 5; attempt++) {
      const retryAfter = consumeRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, userId);
      if (retryAfter !== null) {
        blockedAt = attempt;
        break;
      }
    }
    expect(blockedAt).toBe(LOBBY_JOIN_ATTEMPT_LIMIT.max + 1);
  });

  test("attempts against one lobby/user don't exhaust another user's budget", () => {
    const retryAfter = consumeRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, `fresh-user-${Date.now()}`);
    expect(retryAfter).toBeNull();
  });
});

describe("NPC save flooding limit", () => {
  test("a burst of save_npcs beyond the cooldown is throttled", () => {
    const userId = `npc-flood-test-${Date.now()}`;
    expect(consumeRateLimit(NPC_SAVE_LIMIT, userId)).toBeNull();
    expect(consumeRateLimit(NPC_SAVE_LIMIT, userId)).toBeGreaterThan(0);
  });

  test("one user's saves don't throttle another user's", () => {
    const a = `npc-a-${Date.now()}`;
    const b = `npc-b-${Date.now()}`;
    expect(consumeRateLimit(NPC_SAVE_LIMIT, a)).toBeNull();
    expect(consumeRateLimit(NPC_SAVE_LIMIT, b)).toBeNull();
  });
});
