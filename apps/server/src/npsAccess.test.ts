import { describe, expect, test } from "bun:test";
import { canUseNps, npsBucket, npsMode, npsScore, npsWave, parseSlackIds } from "./npsAccess.js";

describe("npsMode", () => {
  test("defaults to off and treats unknown values as off", () => {
    expect(npsMode(undefined)).toBe("off");
    expect(npsMode("")).toBe("off");
    expect(npsMode("true")).toBe("off");
    expect(npsMode("1")).toBe("off");
  });
  test("accepts preview and live, ignoring case and spaces", () => {
    expect(npsMode(" Preview ")).toBe("preview");
    expect(npsMode("LIVE")).toBe("live");
  });
});

describe("parseSlackIds", () => {
  test("keeps well formed ids and drops junk", () => {
    const ids = parseSlackIds("U0A2SJ7B739, U087BHR98AX ,,bogus,<@U1>, u0lower");
    expect([...ids].sort()).toEqual(["U087BHR98AX", "U0A2SJ7B739"]);
  });
  test("empty or missing is an empty set", () => {
    expect(parseSlackIds(undefined).size).toBe(0);
    expect(parseSlackIds("").size).toBe(0);
  });
});

describe("canUseNps", () => {
  const ids = parseSlackIds("U0A2SJ7B739");
  test("off lets nobody in, not even an allowlisted id", () => {
    expect(canUseNps("off", ids, "U0A2SJ7B739")).toBe(false);
  });
  test("preview only lets the allowlisted ids in", () => {
    expect(canUseNps("preview", ids, "U0A2SJ7B739")).toBe(true);
    expect(canUseNps("preview", ids, "U087BHR98AX")).toBe(false);
    expect(canUseNps("preview", ids, undefined)).toBe(false);
  });
  test("preview with an empty allowlist lets nobody in", () => {
    expect(canUseNps("preview", new Set(), "U0A2SJ7B739")).toBe(false);
  });
  test("live lets every signed-in player in", () => {
    expect(canUseNps("live", ids, "U087BHR98AX")).toBe(true);
    expect(canUseNps("live", ids, undefined)).toBe(true);
  });
});

describe("npsWave", () => {
  test("is the UTC year and month", () => {
    expect(npsWave(new Date("2026-11-14T10:00:00Z"))).toBe("2026-11");
    expect(npsWave(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(npsWave(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});

describe("npsBucket and npsScore", () => {
  test("buckets follow the standard 0-6, 7-8, 9-10 split", () => {
    expect(npsBucket(0)).toBe("detractor");
    expect(npsBucket(6)).toBe("detractor");
    expect(npsBucket(7)).toBe("passive");
    expect(npsBucket(8)).toBe("passive");
    expect(npsBucket(9)).toBe("promoter");
    expect(npsBucket(10)).toBe("promoter");
  });
  test("score is promoters minus detractors as a percentage", () => {
    expect(npsScore([10, 10, 9, 7, 3])).toBe(40);
    expect(npsScore([0, 1, 2])).toBe(-100);
    expect(npsScore([9, 10])).toBe(100);
    expect(npsScore([7, 8])).toBe(0);
  });
  test("no answers means no score", () => {
    expect(npsScore([])).toBeNull();
  });
});
