import { beforeEach, describe, expect, mock, test } from "bun:test";

// regression: claimOrder/shipOrder TOCTOU race

type Row = Record<string, unknown>;

const orders = new Map<number, Row>();
const notifications: Row[] = [];

function resetOrders(seed: Row[]) {
  orders.clear();
  for (const o of seed) orders.set(o.id as number, { ...o });
  notifications.length = 0;
}

function makeFakeDb() {
  function ordersTable() {
    return {
      select() {
        return {
          eq(col: string, val: unknown) {
            return {
              maybeSingle: async () => {
                const row = [...orders.values()].find((o) => o[col] === val);
                return { data: row ? { ...row } : null, error: null };
              },
            };
          },
        };
      },
      update(patch: Row) {
        const filters: [string, unknown][] = [];
        const matchNow = () => [...orders.values()].filter((o) => filters.every(([c, v]) => o[c] === v));
        const applyAndReturnIds = () => {
          const matches = matchNow();
          for (const m of matches) Object.assign(orders.get(m.id as number)!, patch);
          return matches.map((m) => ({ id: m.id }));
        };
        const chain = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return chain;
          },
          select: async (_cols?: string) => ({ data: applyAndReturnIds(), error: null }),
          then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
            try {
              applyAndReturnIds();
              resolve({ error: null });
            } catch (e) {
              reject(e);
            }
          },
        };
        return chain;
      },
    };
  }

  return {
    from(table: string) {
      if (table === "shop_orders") return ordersTable();
      if (table === "users")
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { slack_id: null }, error: null }) }) }) };
      if (table === "notifications")
        return {
          insert: async (row: Row) => {
            notifications.push(row);
            return { error: null };
          },
        };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      };
    },
  };
}

const fakeDb = makeFakeDb();
let creditCalls: { slackId: string; amount: number }[] = [];
let modActions: { by: string; action: string }[] = [];

const realDb = await import("@/lib/db");
const realGuard = await import("@/lib/guard");
const realSlack = await import("@/lib/slack");
const realNotify = await import("@/lib/notify");

mock.module("@/lib/db", () => ({
  ...realDb,
  db: fakeDb,
  logModAction: async (_userId: string, action: string, _detail: string, by: string) => {
    modActions.push({ by, action });
  },
  creditFulfillerPixels: async (slackId: string, amount: number) => {
    creditCalls.push({ slackId, amount });
    return "credited";
  },
}));

mock.module("@/lib/guard", () => ({
  ...realGuard,
  requireFulfiller: async () => ({
    session: { slackId: "U_FULFILLER", name: "Fulfiller", exp: 0 },
    isSuper: false,
    isOwner: false,
    perms: new Set(["fulfillment"]),
    canSecondPass: false,
    reviewQueues: "both",
  }),
}));

mock.module("@/lib/slack", () => ({
  ...realSlack,
  dmUser: async () => {},
}));

mock.module("@/lib/notify", () => ({
  ...realNotify,
  dmOrEmail: async () => {},
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

const { claimOrder, shipOrder } = await import("./actions");

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("fulfillment race: concurrent requests never double-fire side effects", () => {
  beforeEach(() => {
    creditCalls = [];
    modActions = [];
  });

  test("two concurrent shipOrder calls pay the fulfiller exactly once, not twice", async () => {
    resetOrders([
      { id: 1, user_id: "u1", item_name: "Sticker pack", status: "credited", claimed_by_slack: "U_FULFILLER" },
    ]);
    await Promise.all([
      shipOrder(fd({ id: "1", tracking: "TRACK1" })),
      shipOrder(fd({ id: "1", tracking: "TRACK2" })),
    ]);
    expect(orders.get(1)?.status).toBe("shipped");
    expect(creditCalls).toHaveLength(1);
    expect(creditCalls[0]).toEqual({ slackId: "U_FULFILLER", amount: 3 });
  });

  test("two concurrent claimOrder calls only log one claim, not one per racer", async () => {
    resetOrders([{ id: 2, user_id: "u2", item_name: "Poster", status: "pending" }]);
    await Promise.all([claimOrder(fd({ id: "2" })), claimOrder(fd({ id: "2" }))]);
    expect(orders.get(2)?.status).toBe("ordered");
    const claims = modActions.filter((m) => m.action === "order_claimed");
    expect(claims).toHaveLength(1);
  });
});
