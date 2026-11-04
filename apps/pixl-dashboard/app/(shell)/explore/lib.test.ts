import { describe, expect, test } from "bun:test";
import {
  boardHref,
  classForLevel,
  countdown,
  filtersQuery,
  hours,
  isFiltered,
  isPlayerId,
  parseBoard,
  parseFilters,
  playersQuery,
  rankClass,
  recentActivity,
  statusInfo,
  timeAgo,
  upvoteError,
} from "./lib";

describe("filters", () => {
  test("parses and normalizes search params", () => {
    expect(parseFilters({})).toEqual({ q: "", tier: "all", shipped: "all" });
    expect(parseFilters({ q: "  bot ", tier: "3", shipped: "shipped" })).toEqual({ q: "bot", tier: "3", shipped: "shipped" });
    expect(parseFilters({ tier: "9", shipped: "maybe" })).toEqual({ q: "", tier: "all", shipped: "all" });
    expect(parseFilters({ q: ["a", "b"] }).q).toBe("a");
    expect(parseFilters({ q: "x".repeat(200) }).q.length).toBe(64);
  });

  test("builds the query string", () => {
    expect(filtersQuery({ q: "", tier: "all", shipped: "all" })).toBe("");
    expect(filtersQuery({ q: "a b&c", tier: "2", shipped: "unshipped" })).toBe("?q=a+b%26c&tier=2&shipped=unshipped");
    expect(isFiltered({ q: "", tier: "all", shipped: "all" })).toBe(false);
    expect(isFiltered({ q: "", tier: "1", shipped: "all" })).toBe(true);
  });

  test("players query", () => {
    expect(playersQuery("  ")).toBe("");
    expect(playersQuery("Ana & Bo")).toBe("?q=Ana%20%26%20Bo");
  });
});

describe("boards", () => {
  test("parseBoard defaults to pixels", () => {
    expect(parseBoard("referrals")).toBe("referrals");
    expect(parseBoard("upvotes")).toBe("upvotes");
    expect(parseBoard("nope")).toBe("pixels");
    expect(parseBoard(undefined)).toBe("pixels");
  });
  test("boardHref", () => {
    expect(boardHref("pixels")).toBe("/explore/leaderboard");
    expect(boardHref("upvotes")).toBe("/explore/leaderboard?board=upvotes");
  });
  test("rankClass", () => {
    expect(rankClass(1)).toBe("top1");
    expect(rankClass(3)).toBe("top3");
    expect(rankClass(4)).toBe("");
  });
});

describe("formatting", () => {
  test("statusInfo only says SHIPPED once approved", () => {
    expect(statusInfo("approved").label).toBe("SHIPPED");
    expect(statusInfo("shipped").label).toBe("IN REVIEW");
    expect(statusInfo("second_review").tone).toBe("review");
    expect(statusInfo("needs_changes").label).toBe("NEEDS CHANGES");
    expect(statusInfo(undefined).label).toBe("DRAFT");
    expect(statusInfo("some_thing").label).toBe("SOME THING");
  });
  test("hours", () => {
    expect(hours(5400)).toBe("1.5h");
    expect(hours(0)).toBe("");
    expect(hours(null)).toBe("");
  });
  test("timeAgo", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(timeAgo("2026-10-11T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-11T11:00:00Z", now)).toBe("1h ago");
    expect(timeAgo("2026-10-08T12:00:00Z", now)).toBe("3d ago");
    expect(timeAgo("", now)).toBe("");
    expect(timeAgo("garbage", now)).toBe("");
  });
  test("countdown", () => {
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(countdown("2026-10-10T00:00:00Z", now)).toBe("gone!");
    expect(countdown("2026-10-14T05:00:00Z", now)).toBe("3d 5h left");
    expect(countdown("2026-10-11T02:30:00Z", now)).toBe("2h 30m left");
  });
  test("classForLevel", () => {
    expect(classForLevel(1)).toBe("ROOKIE BUILDER");
    expect(classForLevel(5)).toBe("BUILDER");
    expect(classForLevel(100)).toBe("PIXL LEGEND");
    expect(classForLevel(undefined)).toBe("ROOKIE BUILDER");
  });
  test("upvoteError", () => {
    expect(upvoteError("own_project")).toContain("own project");
    expect(upvoteError("weird")).toBe("Couldn't upvote right now.");
  });
});

test("recentActivity merges, sorts newest first, caps at 6", () => {
  const projects = [
    { name: "A", shipped_at: "2026-01-01T00:00:00Z" },
    { name: "Draft", shipped_at: null },
    { name: "B", shipped_at: "2026-03-01T00:00:00Z" },
  ];
  const badges = [{ name: "Gem", unlocked_at: "2026-02-01T00:00:00Z" }];
  const ev = recentActivity(projects, badges);
  expect(ev.map((e) => e.name)).toEqual(["B", "Gem", "A"]);
  expect(ev[1].kind).toBe("badge");
  const many = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, shipped_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
  expect(recentActivity(many, []).length).toBe(6);
});

test("isPlayerId accepts uuids only", () => {
  expect(isPlayerId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  expect(isPlayerId("../admin")).toBe(false);
  expect(isPlayerId(42)).toBe(false);
});
