import { expect, test } from "bun:test";
import { chapterWindowStart, type ChapterLevel } from "./vaultWindow";

const lv = (unlocked_at: string | null): ChapterLevel => ({ unlocked_at });

test("the first chapter has no window start", () => {
  const first = lv(null);
  expect(chapterWindowStart([first], first)).toBeNull();
});

test("the window opens when the most recent other chapter settled", () => {
  const a = lv("2026-01-01T00:00:00Z");
  const b = lv(null);
  expect(chapterWindowStart([a, b], b)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
});

test("the latest settlement wins whatever order the chapters are listed or numbered in", () => {
  const a = lv("2026-01-01T00:00:00Z");
  const hidden = lv("2026-03-01T00:00:00Z");
  const open = lv(null);
  for (const list of [[a, hidden, open], [open, hidden, a], [hidden, open, a]])
    expect(chapterWindowStart(list, open)?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
});

test("unsettled chapters and the target itself are ignored", () => {
  const target = lv(null);
  expect(chapterWindowStart([lv(null), target, lv(null)], target)).toBeNull();
});
