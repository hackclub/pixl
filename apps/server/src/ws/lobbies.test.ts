import { describe, expect, test } from "bun:test";
import {
  LOBBY_PASSWORD_LENGTH,
  genLobbyPassword,
  isStrongLobbyPassword,
  lobbyPasswordMatches,
} from "./lobbies.js";

describe("lobby password generation", () => {
  test("is at least 40 bits, no longer a 4-digit code", () => {
    expect(LOBBY_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    expect(32 ** LOBBY_PASSWORD_LENGTH).toBeGreaterThanOrEqual(2 ** 40);
  });

  test("uses only unambiguous uppercase characters", () => {
    for (let i = 0; i < 500; i++) {
      expect(genLobbyPassword()).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
  });

  test("has the configured length", () => {
    expect(genLobbyPassword()).toHaveLength(LOBBY_PASSWORD_LENGTH);
  });

  test("does not repeat across a large sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) seen.add(genLobbyPassword());
    expect(seen.size).toBe(5_000);
  });

  test("draws from the whole alphabet at every position", () => {
    const perPosition = Array.from({ length: LOBBY_PASSWORD_LENGTH }, () => new Set<string>());
    for (let i = 0; i < 3_000; i++) {
      [...genLobbyPassword()].forEach((ch, pos) => perPosition[pos].add(ch));
    }
    for (const chars of perPosition) expect(chars.size).toBe(32);
  });
});

describe("isStrongLobbyPassword", () => {
  test("rejects the legacy 4-digit codes and empty values", () => {
    expect(isStrongLobbyPassword("1234")).toBe(false);
    expect(isStrongLobbyPassword("9999")).toBe(false);
    expect(isStrongLobbyPassword("")).toBe(false);
  });

  test("accepts a freshly generated password", () => {
    expect(isStrongLobbyPassword(genLobbyPassword())).toBe(true);
  });
});

describe("lobbyPasswordMatches", () => {
  test("matches the exact secret", () => {
    expect(lobbyPasswordMatches("K7M2QX9F", "K7M2QX9F")).toBe(true);
  });

  test("ignores case and surrounding whitespace on both sides", () => {
    expect(lobbyPasswordMatches("  k7m2qx9f\n", "K7M2QX9F")).toBe(true);
    expect(lobbyPasswordMatches("K7M2QX9F", "k7m2qx9f")).toBe(true);
  });

  test("rejects near misses, prefixes, and extensions", () => {
    expect(lobbyPasswordMatches("K7M2QX9G", "K7M2QX9F")).toBe(false);
    expect(lobbyPasswordMatches("K7M2QX9", "K7M2QX9F")).toBe(false);
    expect(lobbyPasswordMatches("K7M2QX9FF", "K7M2QX9F")).toBe(false);
  });

  test("a lobby with no secret never matches, not even an empty guess", () => {
    expect(lobbyPasswordMatches("", "")).toBe(false);
    expect(lobbyPasswordMatches("anything", "")).toBe(false);
  });
});
