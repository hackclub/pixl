// Pins /calc's payout math to apps/server's. Two layers:
//  1. a table of values produced by running apps/server/src/config.generated.ts
//     (the functions apps/server/src/xp.ts credits with) under bun, which
//     always runs, even where apps/server isn't checked out (the Docker build
//     context only contains this app);
//  2. a live comparison against that server module when it is on disk.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { config } from "@/app/_generated/config";
import { combinedStats, formatRows, parseRows, payoutStats, projectPayoutPx, projectPayoutUsd, reForHours, clampTier, clampHours } from "./economy";

// [hours, tier, reBefore, reForHours, projectPayoutUsd, projectPayoutPx]
// generated with apps/server/src/config.generated.ts on 2026-10-11.
const SERVER_TABLE: [number, number, number, number, number, number][] = [
  [0, 1, 0, 0, 0, 0],
  [1, 1, 0, 12.5, 4.006666666666667, 40.06666666666666],
  [10, 1, 0, 125, 40.666666666666664, 406.66666666666663],
  [10, 2, 0, 150, 40.8, 407.99999999999994],
  [10, 3, 0, 187.5, 41, 410],
  [10, 4, 0, 250, 41.333333333333336, 413.3333333333333],
  [2.5, 2, 500, 37.5, 10.716666666666669, 107.16666666666669],
  [40, 4, 1000, 1000, 202.66666666666666, 2026.6666666666665],
  [100, 4, 0, 2500, 533.3333333333333, 5333.333333333332],
  [10, 1, 3750, 125, 60, 600],
  [10, 3, 5000, 187.5, 60, 600],
  [7.25, 2, 1874, 108.75, 36.66663333333333, 366.6663333333333],
  [0.5, 5, 0, 12.5, 2.0033333333333334, 20.03333333333333],
  [3, 0, 0, 37.5, 12.059999999999999, 120.59999999999998],
  [20, 2, -50, 300, 82.66666666666667, 826.6666666666666],
];

describe("calc economy matches apps/server (table)", () => {
  test("economy constants are the ones the table was generated with", () => {
    expect(config.economy.basePayoutUsd).toBe(4);
    expect(config.economy.maxPayoutUsd).toBe(6);
    expect(config.economy.payoutSlopeRe).toBe(1875);
    expect(config.economy.pixelValueUsd).toBe(0.1);
    expect([...config.economy.tierRePerHour]).toEqual([12.5, 15, 18.75, 25]);
  });

  for (const [h, t, r, re, usd, px] of SERVER_TABLE) {
    test(`hours=${h} tier=${t} reBefore=${r}`, () => {
      expect(reForHours(h, t)).toBe(re);
      expect(projectPayoutUsd(h, t, r)).toBe(usd);
      expect(projectPayoutPx(h, t, r)).toBe(px);
    });
  }
});

const SERVER_MODULE = fileURLToPath(new URL("../../../../server/src/config.generated.ts", import.meta.url));
const haveServer = existsSync(SERVER_MODULE);

describe.skipIf(!haveServer)("calc economy matches apps/server (live module)", () => {
  test("identical outputs across a grid of inputs", async () => {
    // Computed specifier so the Next build's type check never tries to
    // resolve a file outside this app's Docker build context.
    const server = (await import(SERVER_MODULE)) as {
      reForHours: typeof reForHours;
      projectPayoutUsd: typeof projectPayoutUsd;
      projectPayoutPx: typeof projectPayoutPx;
      config: typeof config;
    };
    expect(server.config.economy).toEqual(config.economy);
    for (const h of [0, 0.25, 1, 3.5, 10, 33.3, 120]) {
      for (const t of [0, 1, 2, 3, 4, 7]) {
        for (const r of [0, 100, 1874.9, 1875, 3749, 3750, 9000]) {
          expect(reForHours(h, t)).toBe(server.reForHours(h, t));
          expect(projectPayoutUsd(h, t, r)).toBe(server.projectPayoutUsd(h, t, r));
          expect(projectPayoutPx(h, t, r)).toBe(server.projectPayoutPx(h, t, r));
        }
      }
    }
  });
});

describe("payoutStats (what the page shows)", () => {
  test("rounds pixels and RE, averages dollars per hour", () => {
    expect(payoutStats(10, 2, 0)).toEqual({ px: 408, re: 150, avgUsdPerHour: 40.8 / 10 });
  });

  test("zero hours has no average", () => {
    expect(payoutStats(0, 1, 0)).toEqual({ px: 0, re: 0, avgUsdPerHour: null });
  });

  test("input clamps", () => {
    expect(clampTier("9")).toBe(4);
    expect(clampTier("x")).toBe(1);
    expect(clampHours("-3")).toBe(0);
    expect(clampHours("2.5")).toBe(2.5);
  });
});

describe("combinedStats", () => {
  test("one row equals payoutStats", () => {
    const c = combinedStats([{ hours: 10, tier: 2 }], 500);
    const s = payoutStats(10, 2, 500);
    expect({ px: c.px, re: c.re, avg: c.avgUsdPerHour }).toEqual({ px: s.px, re: s.re, avg: s.avgUsdPerHour });
  });

  test("later projects start from the RE earlier ones banked", () => {
    const rows = [
      { hours: 10, tier: 1 },
      { hours: 10, tier: 3 },
    ];
    const c = combinedStats(rows, 0);
    const second = projectPayoutPx(10, 3, reForHours(10, 1));
    expect(c.px).toBe(Math.round(projectPayoutPx(10, 1, 0) + second));
    expect(c.re).toBe(Math.round(reForHours(10, 1) + reForHours(10, 3)));
    expect(c.hours).toBe(20);
    expect(c.rows).toHaveLength(2);
  });

  test("empty list is zero", () => {
    expect(combinedStats([], 100)).toMatchObject({ px: 0, re: 0, avgUsdPerHour: null });
  });

  test("rows param round-trips, clamps and caps", () => {
    expect(parseRows("10:2,3.5:9,x:y")).toEqual([
      { hours: 10, tier: 2 },
      { hours: 3.5, tier: 4 },
      { hours: 0, tier: 1 },
    ]);
    expect(parseRows(formatRows([{ hours: 4, tier: 3 }]))).toEqual([{ hours: 4, tier: 3 }]);
    expect(parseRows(Array(50).fill("1:1").join(","))).toHaveLength(20);
    expect(parseRows(undefined)).toEqual([]);
  });
});
