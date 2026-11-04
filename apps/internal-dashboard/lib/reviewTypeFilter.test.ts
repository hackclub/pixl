import { describe, expect, test } from "bun:test";
import { filterReviewType, parseReviewTypeFilter, reviewTypeGroup } from "./reviewTypeFilter";
import { openableQueueIds } from "./reviewAssignment";

describe("review project type filters", () => {
  test("groups the existing submission types without assuming web means game", () => {
    expect(reviewTypeGroup("web")).toBe("web");
    for (const type of ["windows", "mac", "linux", "cross_platform"]) {
      expect(reviewTypeGroup(type)).toBe("desktop");
    }
    expect(reviewTypeGroup("python")).toBe("python");
    expect(reviewTypeGroup("android")).toBe("mobile");
    expect(reviewTypeGroup("ios")).toBe("mobile");
    expect(reviewTypeGroup("hardware")).toBe("hardware");
    expect(reviewTypeGroup("cad")).toBe("cad");
    expect(reviewTypeGroup(null)).toBe("other");
    expect(reviewTypeGroup("unknown")).toBe("other");
    expect(reviewTypeGroup("web", true)).toBe("games");
    expect(reviewTypeGroup("hardware", true)).toBe("games");
  });

  test("rejects unsupported type filter URLs", () => {
    expect(parseReviewTypeFilter(undefined)).toBe("all");
    expect(parseReviewTypeFilter("game")).toBe("all");
    expect(parseReviewTypeFilter("games")).toBe("games");
    expect(parseReviewTypeFilter("python")).toBe("python");
  });

  test("filters without reordering the oldest-first queue", () => {
    const rows = [{ id: 3, project_type: "web" }, { id: 1, project_type: "python" }, { id: 2, project_type: "web" }];
    expect(filterReviewType(rows, "web").map((r) => r.id)).toEqual([3, 2]);
    expect(filterReviewType(rows, "all").map((r) => r.id)).toEqual([3, 1, 2]);
  });

  test("Games are an exclusive category across platform types", () => {
    const rows = [
      { id: 1, project_type: "web", is_game: true },
      { id: 2, project_type: "web", is_game: false },
      { id: 3, project_type: "hardware", is_game: true },
      { id: 4, project_type: "python", is_game: null },
    ];
    expect(filterReviewType(rows, "games").map((p) => p.id)).toEqual([1, 3]);
    expect(filterReviewType(rows, "web").map((p) => p.id)).toEqual([2]);
    expect(filterReviewType(rows, "python").map((p) => p.id)).toEqual([4]);
    expect(filterReviewType(rows, "all").map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  test("type filters never change which projects are openable", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1, status: "shipped", project_type: i < 15 ? "web" : "python", is_game: i >= 15,
    }));
    const allowed = openableQueueIds(rows, "UREVIEWER", false, Date.now());
    expect(allowed.size).toBe(25);
    const games = filterReviewType(rows, "games");
    const web = filterReviewType(rows, "web");
    expect(games).toHaveLength(10);
    expect(web).toHaveLength(15);
    expect([...games, ...web].every((p) => allowed.has(p.id))).toBe(true);
  });
});
