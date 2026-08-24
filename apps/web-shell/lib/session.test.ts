import { beforeAll, describe, expect, test } from "bun:test";
import jwt from "jsonwebtoken";
import { verifySessionToken } from "./session.ts";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-do-not-use-in-prod";
});

describe("verifySessionToken", () => {
  test("decodes a token signed with the matching secret", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, process.env.JWT_SECRET!);
    expect(verifySessionToken(token)).toEqual({ userId: "u1", displayName: "Test User" });
  });

  test("rejects a token signed with a different secret", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, "wrong-secret");
    expect(verifySessionToken(token)).toBeNull();
  });

  test("rejects garbage input", () => {
    expect(verifySessionToken("not-a-jwt")).toBeNull();
  });

  test("rejects an expired token", () => {
    const token = jwt.sign({ userId: "u1", displayName: "Test User" }, process.env.JWT_SECRET!, {
      expiresIn: -10,
    });
    expect(verifySessionToken(token)).toBeNull();
  });
});
