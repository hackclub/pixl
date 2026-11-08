import { describe, expect, test } from "bun:test";
import { hackatimeDonutSlices } from "./hackatimeChart";
import type { HackatimeBreakdown } from "./hackatime";

const entry = (name: string, seconds: number, color?: string): HackatimeBreakdown => ({
  name, seconds, text: "", percent: 0, color,
});

describe("hackatime donut chart data", () => {
  test("uses seconds, not the rounded/inconsistent API percentages", () => {
    const data = hackatimeDonutSlices([entry("TypeScript", 7200), entry("Python", 3600)]);
    expect(data.map((r) => r.percent)).toEqual([100 * 2 / 3, 100 / 3]);
    expect(data.reduce((sum, r) => sum + r.value, 0)).toBe(10800);
  });

  test("sorts by time and groups small categories into Other", () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry(`Language ${i}`, (i + 1) * 3600));
    const rows = hackatimeDonutSlices(entries);
    expect(rows).toHaveLength(7);
    expect(rows[0].label).toBe("Language 8");
    expect(rows[6].label).toBe("Other categories");
    expect(rows[6].value).toBe(6 * 3600);
    expect(rows.reduce((sum, r) => sum + r.value, 0)).toBe(45 * 3600);
    expect(rows.reduce((sum, r) => sum + r.percent, 0)).toBeCloseTo(100);
  });

  test("omits bad durations and empty labels", () => {
    const rows = hackatimeDonutSlices([
      entry("Valid", 120),
      entry("NaN", Number.NaN),
      entry("Infinity", Infinity),
      entry("Negative", -100),
      entry("", 200),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Valid", value: 120, percent: 100 });
    expect(hackatimeDonutSlices([])).toEqual([]);
  });

  test("only permits hex Hackatime colors", () => {
    const rows = hackatimeDonutSlices([
      entry("C", 30, "#abc"),
      entry("B", 20, "url(https://example.com/track)"),
    ]);
    expect(rows[0].color).toBe("#abc");
    expect(rows[1].color).toBe("var(--hc-purple)");
  });

  test("single slice and top category limit never divide by zero", () => {
    expect(hackatimeDonutSlices([entry("Only", 1)], 0)).toHaveLength(1);
    expect(hackatimeDonutSlices([entry("Only", 0)])).toEqual([]);
  });
});
