import { describe, expect, test } from "bun:test";
import {
  buildGrantExport,
  fundingGrantCents,
  grantCsv,
  selectGrantRows,
  type GrantOrderLike,
} from "./grantExport";
import { FUNDING_ORDER_PREFIX } from "./eligibility/policy";

const order = (over: Partial<GrantOrderLike> = {}): GrantOrderLike => ({
  id: 1,
  user_id: "user-1",
  item_name: "Hardware Grant",
  quantity: 1,
  note: "",
  item_description: "A stackable $10 grant to spend on any hardware for your projects.",
  ...over,
});

const buyers = new Map([["user-1", { name: "Ada Lovelace", email: "ada@example.com" }]]);

describe("project funding grants", () => {
  test("reads the amount withheld when the order was created", () => {
    expect(fundingGrantCents("$10.00 hardware funding grant approved with this ship, withheld from payout.")).toBe(1000);
    expect(fundingGrantCents("no dollars here")).toBeNull();
  });
});

describe("buildGrantExport", () => {
  test("builds one row per order and multiplies quantity", () => {
    const { rows, problems, totalCents } = buildGrantExport(
      [order({ id: 4, quantity: 2 }), order({ id: 5 })],
      buyers,
    );
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.orderId, r.amountCents])).toEqual([
      [4, 2000],
      [5, 1000],
    ]);
    expect(totalCents).toBe(3000);
    expect(rows[0].purpose).toBe("Hardware Grant");
    expect(rows[0].instructions).toContain("2x Hardware Grant");
  });

  test("uses the $10 face value for AI subscriptions with no amount in the description", () => {
    const { rows, problems } = buildGrantExport(
      [
        order({
          id: 411,
          item_name: "AI subscription/credits",
          quantity: 1,
          item_description: "Pick an AI subscription or credits from the provider of your choice.",
        }),
        order({
          id: 412,
          item_name: "AI subscription/credits",
          quantity: 2,
          item_description: "A $20 plan or $10 a month.",
        }),
      ],
      buyers,
    );
    expect(problems).toEqual([]);
    expect(rows.map((r) => [r.orderId, r.amountCents])).toEqual([
      [411, 1000],
      [412, 2000],
    ]);
  });

  test("uses the funding note and the project name for project grants", () => {
    const { rows } = buildGrantExport(
      [
        order({
          id: 9,
          item_name: `${FUNDING_ORDER_PREFIX}Pixel Pet`,
          note: "$25.00 hardware funding grant approved with this ship, withheld from payout.",
          item_description: null,
        }),
      ],
      buyers,
    );
    expect(rows[0]).toMatchObject({ amountCents: 2500, purpose: "PIXL hardware funding" });
    expect(rows[0].instructions).toContain("Pixel Pet");
  });

  test("skips rows without an email or a readable amount instead of guessing", () => {
    const { rows, problems } = buildGrantExport(
      [
        order({ id: 1, user_id: "unknown" }),
        order({ id: 2, item_name: "Mystery Grant", item_description: "A grant with no price." }),
        order({ id: 3, item_name: "Mystery Grant", item_description: "A $9999 grant" }),
      ],
      buyers,
    );
    expect(rows).toEqual([]);
    expect(problems.map((p) => p.orderId)).toEqual([1, 2, 3]);
    expect(problems[0].reason).toContain("email");
    expect(problems[1].reason).toContain("description");
    expect(problems[2].reason).toContain("over");
  });

  test("trims purpose to HCB's 30-character limit", () => {
    const { rows } = buildGrantExport(
      [order({ item_name: "Monitor Grant (Stackable)" })],
      buyers,
    );
    expect(rows[0].purpose.length).toBeLessThanOrEqual(30);
    expect(rows[0].itemName).toBe("Monitor Grant (Stackable)");
  });
});

describe("selected rows", () => {
  test("keeps only the selected ids and ignores stale or unknown ones", () => {
    const { rows } = buildGrantExport([order({ id: 4 }), order({ id: 5 })], buyers);
    expect(selectGrantRows(rows, [5]).map((r) => r.orderId)).toEqual([5]);
    expect(selectGrantRows(rows, [4, 5]).map((r) => r.orderId)).toEqual([4, 5]);
    expect(selectGrantRows(rows, [99])).toEqual([]);
  });

  test("matches bigint ids that arrive as strings", () => {
    const { rows } = buildGrantExport([order({ id: "5" as unknown as number })], buyers);
    expect(selectGrantRows(rows, [5]).map((r) => Number(r.orderId))).toEqual([5]);
  });
});

describe("grantCsv", () => {
  test("writes the HCB template header and one row per grant", () => {
    const { rows } = buildGrantExport([order()], buyers);
    const csv = grantCsv(rows);
    const [header, row] = csv.trimEnd().split("\n");
    expect(header).toBe(
      "email,amount_cents,purpose,instructions,one_time_use,pre_authorization_required,invite_message,merchant_lock,category_lock,keyword_lock,banned_merchants,banned_categories",
    );
    expect(row).toContain('"ada@example.com",1000,"Hardware Grant","For your PIXL shop order #1: Hardware Grant."');
    expect(row.endsWith(",,,,,,,,")).toBe(true);
    expect(csv.endsWith("\n")).toBe(true);
  });

  test("quotes commas and neutralizes formula injection", () => {
    const { rows } = buildGrantExport([order({ id: 7 })], new Map([["user-1", { name: "x", email: "=cmd@example.com" }]]));
    const row = grantCsv(rows).trimEnd().split("\n")[1];
    expect(row.startsWith('"\'=cmd@example.com"')).toBe(true);
    expect(row).toContain('"For your PIXL shop order #7: Hardware Grant."');
  });
});
