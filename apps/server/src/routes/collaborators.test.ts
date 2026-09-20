import { describe, expect, test } from "bun:test";

process.env.JWT_SECRET ??= "test-secret";
const { randomCode } = await import("./collaborators.js");

describe("randomCode", () => {
  test("matches the shareable XXX-XXX shape from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomCode()).toMatch(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    }
  });

  test("produces distinct codes across a batch", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(randomCode());
    expect(seen.size).toBeGreaterThan(490);
  });
});
