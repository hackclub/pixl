import { describe, expect, test } from "bun:test";
import { filterFeed, type FeedItem } from "./db";

function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    kind: "mod",
    text: "Ridit · ban · Somebody",
    detail: "spamming the village",
    href: null,
    when: "2026-09-10T12:00:00.000Z",
    ...over,
  };
}

describe("filterFeed", () => {
  test("returns everything when no filter is set", () => {
    const items = [item(), item({ kind: "review" })];
    expect(filterFeed(items, {})).toHaveLength(2);
  });

  test("keeps only the requested kinds", () => {
    const items = [item({ kind: "mod" }), item({ kind: "review" }), item({ kind: "team" })];
    expect(filterFeed(items, { kinds: ["review", "team"] }).map((i) => i.kind)).toEqual([
      "review",
      "team",
    ]);
  });

  test("an empty kinds array means no kind filter, not zero results", () => {
    expect(filterFeed([item()], { kinds: [] })).toHaveLength(1);
  });

  test("searches the detail as well as the text", () => {
    const items = [item({ detail: "spamming the village" }), item({ detail: "off topic" })];
    expect(filterFeed(items, { q: "village" })).toHaveLength(1);
  });

  test("search is case-insensitive and ignores surrounding space", () => {
    expect(filterFeed([item({ text: "Ridit BANNED someone" })], { q: "  banned " })).toHaveLength(1);
  });

  test("drops entries older than since", () => {
    const items = [
      item({ when: "2026-09-01T00:00:00.000Z" }),
      item({ when: "2026-09-11T00:00:00.000Z" }),
    ];
    const kept = filterFeed(items, { since: "2026-09-05T00:00:00.000Z" });
    expect(kept.map((i) => i.when)).toEqual(["2026-09-11T00:00:00.000Z"]);
  });

  test("compares instants, not timestamp strings", () => {
    // Same moment, two serialisations. A raw string compare would drop the
    // "+00:00" row because "+" sorts below "Z".
    const kept = filterFeed([item({ when: "2026-09-11T00:00:00+00:00" })], {
      since: "2026-09-10T00:00:00.000Z",
    });
    expect(kept).toHaveLength(1);
  });

  test("an unparseable since is ignored rather than dropping everything", () => {
    expect(filterFeed([item()], { since: "not a date" })).toHaveLength(1);
  });

  test("combines every filter", () => {
    const items = [
      item({ kind: "mod", text: "ban", when: "2026-09-11T00:00:00.000Z" }),
      item({ kind: "review", text: "ban", when: "2026-09-11T00:00:00.000Z" }),
      item({ kind: "mod", text: "warn", when: "2026-09-11T00:00:00.000Z" }),
      item({ kind: "mod", text: "ban", when: "2026-01-01T00:00:00.000Z" }),
    ];
    const kept = filterFeed(items, {
      kinds: ["mod"],
      q: "ban",
      since: "2026-09-01T00:00:00.000Z",
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.when).toBe("2026-09-11T00:00:00.000Z");
  });
});
