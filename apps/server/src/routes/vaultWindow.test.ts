import { expect, test } from "bun:test";
import { chapterWindowStart, type ChapterLevel } from "./vaultWindow";

const lv = (position: number, level: number, unlocked_at: string | null): ChapterLevel => ({ position, level, unlocked_at });

test("the first chapter has no window start", () => {
  const first = lv(1, 1, null);
  expect(chapterWindowStart([first], first)).toBeNull();
});

test("the window opens when the previous chapter unlocked", () => {
  const a = lv(1, 1, "2026-01-01T00:00:00Z");
  const b = lv(2, 2, null);
  expect(chapterWindowStart([a, b], b)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
});

test("a settled chapter between two others still bounds the window whatever its visibility", () => {
  const a = lv(1, 1, "2026-01-01T00:00:00Z");
  const hidden = lv(2, 2, "2026-03-01T00:00:00Z");
  const open = lv(3, 3, null);
  expect(chapterWindowStart([a, hidden, open], open)?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
});

test("chapters after the target and unsettled chapters before it are ignored", () => {
  const a = lv(1, 1, null);
  const target = lv(2, 2, null);
  const later = lv(3, 3, "2026-05-01T00:00:00Z");
  expect(chapterWindowStart([a, target, later], target)).toBeNull();
});

test("ties on position fall back to level order", () => {
  const a = lv(1, 1, "2026-01-01T00:00:00Z");
  const b = lv(1, 2, null);
  expect(chapterWindowStart([a, b], b)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  expect(chapterWindowStart([a, b], a)).toBeNull();
});
