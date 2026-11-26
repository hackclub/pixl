import { describe, expect, test } from "bun:test";
import { staffName } from "./staffName";

describe("staffName", () => {
  test("strips the (SlackID) suffix", () => {
    expect(staffName("Ada Lovelace (U_ADA)")).toBe("Ada Lovelace");
    expect(staffName("Plain Name")).toBe("Plain Name");
    expect(staffName("U_ADA")).toBe("U_ADA");
  });

  test("empty labels fall back to the given default", () => {
    expect(staffName(null)).toBe("Reviewer");
    expect(staffName("", "a reviewer")).toBe("a reviewer");
  });
});
