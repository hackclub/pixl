import { afterEach, describe, expect, test } from "bun:test";

const { db } = await import("./db/pgCompat.js");
const { beaconUnlocks } = await import("./beacons.js");

type Call = { table: string; method: string; args: unknown[] };

let restore: (() => void) | null = null;

function mockDb(results: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  const realFrom = db.from;
  db.from = ((table: string) => {
    const chain = {
      select: (...args: unknown[]) => {
        calls.push({ table, method: "select", args });
        return chain;
      },
      eq: (...args: unknown[]) => {
        calls.push({ table, method: "eq", args });
        return chain;
      },
      neq: (...args: unknown[]) => {
        calls.push({ table, method: "neq", args });
        return chain;
      },
      is: (...args: unknown[]) => {
        calls.push({ table, method: "is", args });
        return chain;
      },
      in: (...args: unknown[]) => {
        calls.push({ table, method: "in", args });
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(results[table] ?? { data: null, error: null }).then(resolve, reject),
    };
    return chain;
  }) as unknown as typeof db.from;
  restore = () => {
    db.from = realFrom;
  };
  return calls;
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe("beaconUnlocks", () => {
  test("subtracts distinct owned Beacon rewards from the project count", async () => {
    const calls = mockDb({
      projects: { count: 2, data: null, error: null },
      shop_items: { data: [{ id: 10 }, { id: 11 }], error: null },
      shop_orders: { data: [{ item_id: 10 }, { item_id: 10 }], error: null },
    });

    const result = await beaconUnlocks("user-a");

    expect(result.projects).toBe(2);
    expect(result.available).toBe(1);
    expect([...result.owned]).toEqual([10]);
    expect(calls.some((c) => c.table === "projects" && c.method === "eq" && c.args[0] === "is_peak")).toBe(true);
    expect(
      calls.some((c) => c.table === "shop_orders" && c.method === "neq" && c.args[0] === "status" && c.args[1] === "cancelled"),
    ).toBe(true);
  });

  test("never reports negative unlocks when more rewards are owned than projects", async () => {
    mockDb({
      projects: { count: 1, data: null, error: null },
      shop_items: { data: [{ id: 10 }, { id: 11 }], error: null },
      shop_orders: { data: [{ item_id: 10 }, { item_id: 11 }], error: null },
    });

    const result = await beaconUnlocks("user-a");

    expect(result.available).toBe(0);
    expect(result.owned.size).toBe(2);
  });

  test("skips the orders query when the shop has no Beacon rewards", async () => {
    const calls = mockDb({
      projects: { count: 3, data: null, error: null },
      shop_items: { data: [], error: null },
    });

    const result = await beaconUnlocks("user-a");

    expect(result.projects).toBe(3);
    expect(result.available).toBe(3);
    expect(result.owned.size).toBe(0);
    expect(calls.some((c) => c.table === "shop_orders")).toBe(false);
  });
});
