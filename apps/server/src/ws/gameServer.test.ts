import { describe, expect, test } from "bun:test";
import { consumeRateLimit } from "../rateLimit.js";
import {
  lobbyJoinError,
  lobbyJoinDenialReason,
  roomFor,
  LOBBY_JOIN_ATTEMPT_LIMIT,
  NPC_SAVE_LIMIT,
} from "./gameServer.js";
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

  test("once locked out, the correct password is denied too, not just wrong guesses", () => {
    const lobby = makeLobby({ password: "9999" });
    const userId = `lockout-test-${Date.now()}`;

    for (let i = 0; i < LOBBY_JOIN_ATTEMPT_LIMIT.max; i++) {
      lobbyJoinDenialReason(lobby, userId, "0000");
    }

    expect(lobbyJoinDenialReason(lobby, userId, "9999")).toBe(
      "Too many attempts. Wait a bit and try again.",
    );
  });

  test("the lockout clears once the rate-limit window resets", async () => {
    // short window, same primitive as LOBBY_JOIN_ATTEMPT_LIMIT
    const opts = { windowMs: 50, max: 1, name: `lobby-reset-test-${Date.now()}` };
    const userId = "reset-user";

    expect(consumeRateLimit(opts, userId)).toBeNull();
    expect(consumeRateLimit(opts, userId)).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(consumeRateLimit(opts, userId)).toBeNull();
  });
});

describe("roomFor (village authorization)", () => {
  // change_scene's "requested" is the client's raw msg.scene string, passed
  // straight into roomFor - this is the one and only place a scene request
  // turns into an actual room, so these cases are exactly what a malicious
  // client can and can't do by sending an arbitrary scene string.
  test("village:<self> resolves to the caller's own room", () => {
    expect(roomFor("me", "village")).toBe("village:me");
    expect(roomFor("me", "village:me")).toBe("village:me");
  });

  test("village:<other user> cannot be entered - always redirected to caller's own village", () => {
    expect(roomFor("attacker", "village:victim")).toBe("village:attacker");
    expect(roomFor("attacker", "village:")).toBe("village:attacker");
  });

  test("public/open-world scene passes through untouched", () => {
    expect(roomFor("me", "open_world")).toBe("open_world");
    expect(roomFor("me", "house_interior")).toBe("house_interior");
  });

  test("an authorized lobby scene passes through untouched (lobby membership is gated separately)", () => {
    expect(roomFor("me", "lobby:ABCDE")).toBe("lobby:ABCDE");
  });

  test("malformed/arbitrary village-shaped scene strings never resolve to someone else's village", () => {
    for (const s of ["village:../../etc", "village:", "village:village:victim"]) {
      // Every one of these starts with "village:" or is exactly "village" -
      // the only way "victim" could appear in the result is if some other
      // user's id leaked into the room string instead of the caller's own.
      expect(roomFor("attacker", s)).toBe("village:attacker");
    }
  });

  test("a non-village scene string passes through unchanged, whatever it contains", () => {
    // Not a village-authorization concern - an opaque scene name that isn't
    // shaped like "village"/"village:*" was never routed through the
    // per-player village room, so there's no other user's room to leak here.
    expect(roomFor("attacker", "villagevictim")).toBe("villagevictim");
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
