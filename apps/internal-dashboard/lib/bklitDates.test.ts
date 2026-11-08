import { describe, expect, test } from "bun:test";
import { chartUtcDate, dateLabel, sparseTicks } from "./bklitDates";

describe("Bklit chart dates", () => {
  test("uses UTC midnight rather than browser timezone", () => {
    expect(chartUtcDate("2026-11-08").toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(dateLabel("2026-11-08")).toBe("Nov 8");
  });
  test("preserves sparse first/middle/last ticks", () => {
    expect(sparseTicks([])).toEqual([]);
    expect(sparseTicks(["2026-11-08"])).toEqual(["2026-11-08"]);
    expect(sparseTicks(["a","b","c","d","e"])).toEqual(["a","c","e"]);
  });
});
