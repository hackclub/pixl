import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { requestIpKey } from "../clientIp.js";
import {
  consumeRateLimit,
  peekRateLimit,
  rateLimitBucketCount,
  sweepRateLimitBuckets,
} from "../rateLimit.js";
import {
  lobbyJoinError,
  lobbyJoinDenialReason,
  roomFor,
  LOBBY_JOIN_ATTEMPT_LIMIT,
  LOBBY_JOIN_IP_LIMIT,
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
    const ip = nextIp();

    for (let i = 0; i < LOBBY_JOIN_ATTEMPT_LIMIT.max; i++) {
      lobbyJoinDenialReason(lobby, userId, "0000", ip);
    }

    expect(lobbyJoinDenialReason(lobby, userId, "9999", ip)).toBe(TOO_MANY);
  });

  test("the lockout clears once the rate-limit window resets", async () => {
    const opts = { windowMs: 50, max: 1, name: `lobby-reset-test-${Date.now()}` };
    const userId = "reset-user";

    expect(consumeRateLimit(opts, userId)).toBeNull();
    expect(consumeRateLimit(opts, userId)).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(consumeRateLimit(opts, userId)).toBeNull();
  });
});

const WRONG = "Wrong password.";
const TOO_MANY = "Too many attempts. Wait a bit and try again.";

let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
let userCounter = 0;
const nextUser = (label = "u") => `${label}-${Date.now()}-${++userCounter}`;

function guessUntilBlocked(lobby: Lobby, users: string[], ips: string[], cap = 200) {
  let wrong = 0;
  const perUser = new Map<string, number>();
  for (let i = 0; i < cap; i++) {
    const user = users[i % users.length];
    const ip = ips[i % ips.length];
    const result = lobbyJoinDenialReason(lobby, user, "WRONG000", ip);
    if (result === TOO_MANY) return { wrong, perUser, blockedAt: i };
    expect(result).toBe(WRONG);
    wrong++;
    perUser.set(user, (perUser.get(user) ?? 0) + 1);
  }
  return { wrong, perUser, blockedAt: -1 };
}

describe("private lobby password guessing: account and source-IP limits", () => {
  afterEach(() => setSystemTime());

  test("one account is stopped at the per-account limit", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const user = nextUser();
    const ips = Array.from({ length: 20 }, nextIp);
    const { wrong } = guessUntilBlocked(lobby, [user], ips);
    expect(wrong).toBe(LOBBY_JOIN_ATTEMPT_LIMIT.max);
    expect(lobbyJoinDenialReason(lobby, user, "K7M2QX9F", nextIp())).toBe(TOO_MANY);
  });

  test("four accounts on one IP share one budget instead of getting 4x", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const users = [nextUser("a"), nextUser("b"), nextUser("c"), nextUser("d")];
    const ip = nextIp();
    const { wrong, perUser } = guessUntilBlocked(lobby, users, [ip]);
    expect(wrong).toBe(LOBBY_JOIN_IP_LIMIT.max);
    expect(wrong).toBeLessThan(users.length * LOBBY_JOIN_ATTEMPT_LIMIT.max);
    for (const count of perUser.values()) expect(count).toBeLessThanOrEqual(LOBBY_JOIN_ATTEMPT_LIMIT.max);
  });

  test("a fresh account on an exhausted IP is blocked even with the right password", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const ip = nextIp();
    guessUntilBlocked(lobby, [nextUser(), nextUser(), nextUser(), nextUser()], [ip]);
    expect(lobbyJoinDenialReason(lobby, nextUser(), "K7M2QX9F", ip)).toBe(TOO_MANY);
  });

  test("different source IPs do not share a bucket", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const burned = nextIp();
    guessUntilBlocked(lobby, [nextUser(), nextUser(), nextUser(), nextUser()], [burned]);

    const otherIp = nextIp();
    const other = nextUser();
    expect(lobbyJoinDenialReason(lobby, other, "WRONG000", otherIp)).toBe(WRONG);
    expect(lobbyJoinDenialReason(lobby, other, "K7M2QX9F", otherIp)).toBeNull();
    expect(peekRateLimit(LOBBY_JOIN_IP_LIMIT, otherIp)).toBeNull();
  });

  test("reconnecting or hopping IPs does not reset an account's budget", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const user = nextUser();
    const first = nextIp();
    for (let i = 0; i < LOBBY_JOIN_ATTEMPT_LIMIT.max; i++) {
      expect(lobbyJoinDenialReason(lobby, user, "WRONG000", first)).toBe(WRONG);
    }
    expect(lobbyJoinDenialReason(lobby, user, "WRONG000", first)).toBe(TOO_MANY);
    expect(lobbyJoinDenialReason(lobby, user, "WRONG000", nextIp())).toBe(TOO_MANY);
    expect(lobbyJoinDenialReason(lobby, user, "K7M2QX9F", nextIp())).toBe(TOO_MANY);
  });

  test("a spoofed CF-Connecting-IP from a direct peer cannot rotate the limiter identity", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const users = [nextUser(), nextUser(), nextUser(), nextUser()];
    const ips = Array.from({ length: 200 }, (_, i) =>
      requestIpKey({
        headers: { "cf-connecting-ip": `203.0.113.${(i % 250) + 1}` },
        socket: { remoteAddress: "198.51.100.77" },
      }),
    );
    expect(new Set(ips).size).toBe(1);
    const { wrong } = guessUntilBlocked(lobby, users, ips);
    expect(wrong).toBe(LOBBY_JOIN_IP_LIMIT.max);
  });

  test("a spoofed X-Forwarded-For prefix cannot rotate the limiter identity", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const users = [nextUser(), nextUser(), nextUser(), nextUser()];
    const ips = Array.from({ length: 200 }, (_, i) =>
      requestIpKey({
        headers: { "x-forwarded-for": `1.1.${Math.floor(i / 250)}.${(i % 250) + 1}, 198.51.100.88` },
        socket: { remoteAddress: "10.0.0.1" },
      }),
    );
    expect(new Set(ips).size).toBe(1);
    const { wrong } = guessUntilBlocked(lobby, users, ips);
    expect(wrong).toBe(LOBBY_JOIN_IP_LIMIT.max);
  });

  test("real clients behind Cloudflare keep separate buckets", () => {
    const behindCf = (client: string) =>
      requestIpKey({
        headers: { "x-forwarded-for": "162.158.10.20", "cf-connecting-ip": client },
        socket: { remoteAddress: "10.0.0.1" },
      });
    expect(behindCf("203.0.113.1")).not.toBe(behindCf("203.0.113.2"));
  });

  test("a correct password never consumes the account or IP budget", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const user = nextUser();
    const ip = nextIp();
    for (let i = 0; i < 100; i++) {
      expect(lobbyJoinDenialReason(lobby, user, "K7M2QX9F", ip)).toBeNull();
    }
    expect(peekRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, user)).toBeNull();
    const { wrong } = guessUntilBlocked(lobby, [user], [ip]);
    expect(wrong).toBe(LOBBY_JOIN_ATTEMPT_LIMIT.max);
  });

  test("the password is case and whitespace insensitive", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    expect(lobbyJoinDenialReason(lobby, nextUser(), " k7m2qx9f ", nextIp())).toBeNull();
  });

  test("the owner joins their own lobby without burning attempts, even from a burned IP", () => {
    const lobby = makeLobby({ password: "K7M2QX9F", ownerId: "owner-x" });
    const ip = nextIp();
    guessUntilBlocked(lobby, [nextUser(), nextUser(), nextUser(), nextUser()], [ip]);
    for (let i = 0; i < 100; i++) {
      expect(lobbyJoinDenialReason(lobby, "owner-x", "", ip)).toBeNull();
    }
    expect(peekRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, "owner-x")).toBeNull();
  });

  test("public lobbies stay open for accounts and IPs that are fully throttled", () => {
    const priv = makeLobby({ password: "K7M2QX9F" });
    const pub = makeLobby({ id: "PUBLC", isPublic: true, password: "" });
    const user = nextUser();
    const ip = nextIp();
    guessUntilBlocked(priv, [user], [ip]);
    expect(lobbyJoinDenialReason(priv, user, "K7M2QX9F", ip)).toBe(TOO_MANY);
    expect(lobbyJoinDenialReason(pub, user, "", ip)).toBeNull();
  });

  test("there is no per-lobby lockout an attacker can use against everyone else", () => {
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const attackerIp = nextIp();
    guessUntilBlocked(lobby, [nextUser(), nextUser(), nextUser(), nextUser()], [attackerIp]);
    expect(lobbyJoinDenialReason(lobby, nextUser("friend"), "K7M2QX9F", nextIp())).toBeNull();
  });

  test("a missing or full lobby does not consume guess budget", () => {
    const user = nextUser();
    const ip = nextIp();
    expect(lobbyJoinDenialReason(undefined, user, "x", ip)).toBe("That lobby doesn't exist.");
    expect(peekRateLimit(LOBBY_JOIN_ATTEMPT_LIMIT, user)).toBeNull();
    expect(peekRateLimit(LOBBY_JOIN_IP_LIMIT, ip)).toBeNull();
  });

  test("buckets expire and are swept once the window passes", () => {
    setSystemTime(new Date("2032-06-01T00:00:00Z"));
    sweepRateLimitBuckets();
    const base = rateLimitBucketCount();
    const lobby = makeLobby({ password: "K7M2QX9F" });
    const user = nextUser();
    const ip = nextIp();
    lobbyJoinDenialReason(lobby, user, "WRONG000", ip);
    expect(rateLimitBucketCount()).toBe(base + 2);
    setSystemTime(new Date("2032-06-01T00:01:01Z"));
    expect(lobbyJoinDenialReason(lobby, user, "K7M2QX9F", ip)).toBeNull();
    sweepRateLimitBuckets();
    expect(rateLimitBucketCount()).toBe(base);
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
