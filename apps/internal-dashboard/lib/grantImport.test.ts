import { describe, expect, test } from "bun:test";
import {
  grantHash,
  grantHashFromLink,
  grantLinkFromId,
  matchGrantsToOrders,
  parseHcbGrantsCsv,
  parseHcbGrantsJson,
  type GrantImportOrder,
  type HcbGrant,
} from "./grantImport";

const order = (over: Partial<GrantImportOrder> = {}): GrantImportOrder => ({
  orderId: 1,
  playerName: "Ada Lovelace",
  itemName: "Hardware Grant",
  quantity: 1,
  amountCents: 1000,
  status: "pending",
  email: "ada@example.com",
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const grant = (over: Partial<HcbGrant> = {}): HcbGrant => ({
  id: "cdg_abc",
  hash: "abc",
  email: "ada@example.com",
  name: "",
  amountCents: 1000,
  purpose: "Hardware Grant",
  status: "active",
  createdAt: "2026-11-02T00:00:00.000Z",
  ...over,
});

const nameGrant = (over: Partial<HcbGrant> = {}): HcbGrant =>
  grant({ email: "", name: "Ada L", ...over });

const cliGrant = (over: Record<string, unknown> = {}) => ({
  id: "cdg_abc",
  object: "card_grant",
  amount_cents: 1000,
  email: "Ada@Example.com",
  purpose: "Hardware Grant",
  status: "active",
  created_at: "2026-11-02T00:00:00.000Z",
  ...over,
});

describe("grant ids and links", () => {
  test("builds the human grant link from the API id", () => {
    expect(grantHash("cdg_abc123")).toBe("abc123");
    expect(grantLinkFromId("cdg_abc123")).toBe("https://hcb.hackclub.com/grants/abc123");
    expect(grantLinkFromId("abc123")).toBe("https://hcb.hackclub.com/grants/abc123");
    expect(grantHashFromLink("https://hcb.hackclub.com/grants/abc123")).toBe("abc123");
  });

  test("rejects ids that would not make a safe path segment", () => {
    expect(grantHash("")).toBeNull();
    expect(grantHash("cdg_")).toBeNull();
    expect(grantHash("../../admin")).toBeNull();
    expect(grantHash("abc/def")).toBeNull();
    expect(grantLinkFromId("cdg_abc?x=1")).toBeNull();
  });
});

describe("parseHcbGrantsJson", () => {
  test("reads the CLI's array and normalizes emails", () => {
    const parsed = parseHcbGrantsJson(JSON.stringify([cliGrant()]));
    expect(parsed.error).toBe("");
    expect(parsed.ignored).toBe(0);
    expect(parsed.grants).toEqual([
      {
        id: "cdg_abc",
        hash: "abc",
        email: "ada@example.com",
        name: "",
        amountCents: 1000,
        purpose: "Hardware Grant",
        status: "active",
        createdAt: "2026-11-02T00:00:00.000Z",
      },
    ]);
  });

  test("accepts a pagination envelope", () => {
    const parsed = parseHcbGrantsJson(JSON.stringify({ data: [cliGrant()] }));
    expect(parsed.grants).toHaveLength(1);
  });

  test("skips canceled, expired and malformed rows instead of matching them", () => {
    const parsed = parseHcbGrantsJson(
      JSON.stringify([
        cliGrant({ id: "cdg_ok" }),
        cliGrant({ id: "cdg_canceled", status: "canceled" }),
        cliGrant({ id: "cdg_expired", status: "expired" }),
        cliGrant({ id: "not-a-grant" }),
        cliGrant({ id: "cdg_zero", amount_cents: 0 }),
        cliGrant({ id: "cdg_no_email", email: "" }),
        "nope",
      ]),
    );
    expect(parsed.grants.map((g) => g.id)).toEqual(["cdg_ok"]);
    expect(parsed.ignored).toBe(6);
  });

  test("explains unreadable input", () => {
    expect(parseHcbGrantsJson("").error).toContain("grants.json");
    expect(parseHcbGrantsJson("{").error).toContain("valid JSON");
    expect(parseHcbGrantsJson("{}").error).toContain("JSON array");
    expect(parseHcbGrantsJson(JSON.stringify([cliGrant({ status: "canceled" })])).error).toContain("No active");
  });
});

describe("parseHcbGrantsCsv", () => {
  test("reads the bookmarklet CSV and keeps the grant link", () => {
    const csv = [
      "email,amount_cents,purpose,grant_link,created_at",
      'ada@example.com,1000,"Hardware Grant",https://hcb.hackclub.com/grants/abc,2026-11-02T00:00:00.000Z',
    ].join("\n");
    const parsed = parseHcbGrantsCsv(csv);
    expect(parsed.error).toBe("");
    expect(parsed.grants).toHaveLength(1);
    expect(parsed.grants[0]).toMatchObject({
      id: "cdg_abc",
      hash: "abc",
      email: "ada@example.com",
      amountCents: 1000,
      purpose: "Hardware Grant",
    });
  });

  test("accepts dollar amounts, header aliases and quoted commas", () => {
    const csv = [
      "Email,Amount,For,Link",
      '"Ada@Example.com","$12.50","Grant, with a comma","https://hcb.hackclub.com/grants/xyz"',
    ].join("\n");
    const parsed = parseHcbGrantsCsv(csv);
    expect(parsed.error).toBe("");
    expect(parsed.grants[0]).toMatchObject({
      email: "ada@example.com",
      amountCents: 1250,
      purpose: "Grant, with a comma",
      id: "cdg_xyz",
    });
  });

  test("treats Invited as active and skips Canceled", () => {
    const csv = [
      "email,amount_cents,purpose,grant_link,status",
      "ada@example.com,1000,First,https://hcb.hackclub.com/grants/one,Invited",
      "ada@example.com,2000,Second,https://hcb.hackclub.com/grants/two,Canceled",
    ].join("\n");
    const parsed = parseHcbGrantsCsv(csv);
    expect(parsed.grants.map((g) => g.id)).toEqual(["cdg_one"]);
    expect(parsed.ignored).toBe(1);
  });

  test("skips rows without an email, link or positive amount", () => {
    const csv = [
      "email,amount_cents,grant_link",
      ",1000,https://hcb.hackclub.com/grants/a",
      "ada@example.com,0,https://hcb.hackclub.com/grants/b",
      "ada@example.com,1000,",
      "ada@example.com,1000,https://hcb.hackclub.com/grants/ok",
    ].join("\n");
    const parsed = parseHcbGrantsCsv(csv);
    expect(parsed.grants.map((g) => g.id)).toEqual(["cdg_ok"]);
    expect(parsed.ignored).toBe(3);
  });

  test("explains when the dashboard's own CSV is imported", () => {
    const parsed = parseHcbGrantsCsv("email,amount_cents,purpose,instructions\nada@example.com,1000,Hardware,For order 1\n");
    expect(parsed.error).toContain("no grant_link");
  });

  test("accepts the bookmarklet's name-only rows", () => {
    const csv = [
      "email,amount_cents,purpose,grant_link,created_at,status,name",
      ',3000,Hardware Grant,https://hcb.hackclub.com/grants/ellie,2026-11-27,Invited,Ellie',
    ].join("\n");
    const parsed = parseHcbGrantsCsv(csv);
    expect(parsed.error).toBe("");
    expect(parsed.grants[0]).toMatchObject({
      id: "cdg_ellie",
      email: "",
      name: "Ellie",
      amountCents: 3000,
      purpose: "Hardware Grant",
    });
  });

  test("requires an email or name column", () => {
    const parsed = parseHcbGrantsCsv("amount_cents,grant_link\n1000,https://hcb.hackclub.com/grants/a\n");
    expect(parsed.error).toContain("email or recipient name");
  });

  test("rejects JSON in the CSV path", () => {
    expect(parseHcbGrantsCsv("[{\"id\":\"cdg_a\"}]").error).toContain("looks like JSON");
  });

  test("explains a saved HCB wrapper page", () => {
    const parsed = parseHcbGrantsCsv("<!doctype html><html><body><turbo-frame src=\"/ysws-pixl/card_grants/card_overview\"></turbo-frame></body></html>");
    expect(parsed.error).toContain("saved HCB page");
    expect(parsed.error).toContain("bookmarklet");
  });

  test("a CSV grant matches and keeps the canonical link", () => {
    const csv = "email,amount_cents,grant_link\nada@example.com,1000,https://hcb.hackclub.com/grants/abc\n";
    const parsed = parseHcbGrantsCsv(csv);
    const preview = matchGrantsToOrders([order()], parsed.grants);
    expect(preview.matches[0]).toMatchObject({
      orderId: 1,
      grantId: "cdg_abc",
      grantLink: "https://hcb.hackclub.com/grants/abc",
    });
  });
});

describe("matchGrantsToOrders", () => {
  test("matches one order to one grant by email and amount", () => {
    const preview = matchGrantsToOrders([order()], [grant()]);
    expect(preview.matches).toHaveLength(1);
    expect(preview.matches[0]).toMatchObject({
      orderId: 1,
      grantId: "cdg_abc",
      grantLink: "https://hcb.hackclub.com/grants/abc",
      amountCents: 1000,
    });
    expect(preview.unmatchedOrders).toEqual([]);
    expect(preview.unusedGrants).toEqual([]);
  });

  test("ignores case and whitespace in emails", () => {
    const preview = matchGrantsToOrders([order({ email: " ADA@example.com " })], [grant({ email: "ada@EXAMPLE.com" })]);
    expect(preview.matches).toHaveLength(1);
  });

  test("flags two grants for one order instead of silently dropping one", () => {
    const preview = matchGrantsToOrders(
      [order()],
      [
        grant({ id: "cdg_a", hash: "a" }),
        grant({ id: "cdg_b", hash: "b" }),
      ],
    );
    expect(preview.matches).toHaveLength(1);
    expect(preview.matches[0]?.note).not.toBe("");
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]?.grantIds).toEqual(["cdg_a", "cdg_b"]);
    expect(preview.warnings[0]?.reason).toContain("more grants than orders");
    expect(preview.unusedGrants.map((g) => g.grantId)).toEqual(["cdg_b"]);
  });

  test("never reuses a grant already recorded on another order", () => {
    const preview = matchGrantsToOrders(
      [order()],
      [grant()],
      ["https://hcb.hackclub.com/grants/abc"],
    );
    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedOrders).toHaveLength(1);
    expect(preview.unusedGrants).toEqual([]);
  });

  test("does not pair different amounts", () => {
    const preview = matchGrantsToOrders([order({ amountCents: 500 })], [grant({ amountCents: 1000 })]);
    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedOrders[0]?.reason).toContain("email and amount");
    expect(preview.unusedGrants[0]?.grantId).toBe("cdg_abc");
  });

  test("pairs duplicate email + amount groups oldest-first and warns", () => {
    const preview = matchGrantsToOrders(
      [
        order({ orderId: 2, createdAt: "2026-11-02T00:00:00.000Z" }),
        order({ orderId: 1, createdAt: "2026-11-01T00:00:00.000Z" }),
      ],
      [
        grant({ id: "cdg_late", hash: "late", createdAt: "2026-11-03T00:00:00.000Z" }),
        grant({ id: "cdg_early", hash: "early", createdAt: "2026-11-02T00:00:00.000Z" }),
      ],
    );
    expect(preview.matches.map((m) => [m.orderId, m.grantId])).toEqual([
      [1, "cdg_early"],
      [2, "cdg_late"],
    ]);
    expect(preview.warnings).toHaveLength(1);
    expect(preview.matches.every((m) => m.note !== "")).toBe(true);
  });

  test("prefers a grant whose purpose carries the order id", () => {
    const preview = matchGrantsToOrders(
      [
        order({ orderId: 1, createdAt: "2026-11-01T00:00:00.000Z" }),
        order({ orderId: 2, createdAt: "2026-11-02T00:00:00.000Z" }),
      ],
      [
        grant({ id: "cdg_first", hash: "first", createdAt: "2026-11-03T00:00:00.000Z" }),
        grant({ id: "cdg_marked", hash: "marked", purpose: "PIXL #2", createdAt: "2026-11-04T00:00:00.000Z" }),
      ],
    );
    expect(preview.matches.map((m) => [m.orderId, m.grantId])).toEqual([
      [1, "cdg_first"],
      [2, "cdg_marked"],
    ]);
  });

  test("does not pair a grant created well before the order", () => {
    const preview = matchGrantsToOrders(
      [order({ createdAt: "2026-11-10T00:00:00.000Z" })],
      [grant({ createdAt: "2026-11-01T00:00:00.000Z" })],
    );
    expect(preview.matches).toEqual([]);
    expect(preview.unusedGrants).toHaveLength(1);
  });

  test("leaves extra grants unused and extra orders unmatched", () => {
    const preview = matchGrantsToOrders(
      [
        order({ orderId: 1 }),
        order({ orderId: 2 }),
      ],
      [grant({ id: "cdg_one", hash: "one" })],
    );
    expect(preview.matches.map((m) => m.orderId)).toEqual([1]);
    expect(preview.unmatchedOrders.map((o) => o.orderId)).toEqual([2]);
    expect(preview.unusedGrants).toEqual([]);

    const extras = matchGrantsToOrders([order()], [grant({ id: "cdg_one", hash: "one" }), grant({ id: "cdg_two", hash: "two" })]);
    expect(extras.matches).toHaveLength(1);
    expect(extras.unusedGrants.map((g) => g.grantId)).toEqual(["cdg_two"]);
  });

  test("matches a bookmarklet row by HCB name + amount + item", () => {
    const preview = matchGrantsToOrders(
      [order({ orderId: 473, playerName: "Ellie Wen", amountCents: 3000, itemName: "Hardware Grant", createdAt: "2026-11-26T00:00:00.000Z" })],
      [nameGrant({ id: "cdg_ellie", hash: "ellie", name: "Ellie", amountCents: 3000, purpose: "Hardware Grant", createdAt: "2026-11-27T00:00:00.000Z" })],
    );
    expect(preview.matches).toHaveLength(1);
    expect(preview.matches[0]).toMatchObject({
      orderId: 473,
      grantId: "cdg_ellie",
      grantLink: "https://hcb.hackclub.com/grants/ellie",
      hcbName: "Ellie",
    });
    expect(preview.matches[0]?.note).toContain("HCB name");
  });

  test("matches a first name + last initial against the full name", () => {
    const preview = matchGrantsToOrders(
      [order({ playerName: "Dániel Tóth", amountCents: 1500, itemName: "Smolhaj" })],
      [nameGrant({ name: "Dániel T", amountCents: 1500, purpose: "Smolhaj" })],
    );
    expect(preview.matches).toHaveLength(1);
  });

  test("matches a username that contains both name parts", () => {
    const preview = matchGrantsToOrders(
      [order({ playerName: "Suhani Sehrawat", amountCents: 1000, itemName: "Art Supply Grant" })],
      [nameGrant({ name: "suhanisehrawatcute", amountCents: 1000, purpose: "Art Supply Grant" })],
    );
    expect(preview.matches).toHaveLength(1);
  });

  test("leaves two same-name orders ambiguous instead of guessing", () => {
    const preview = matchGrantsToOrders(
      [
        order({ orderId: 1, playerName: "Ellie Wen", amountCents: 3000, itemName: "Hardware Grant" }),
        order({ orderId: 2, playerName: "Ellie Wen", amountCents: 3000, itemName: "Hardware Grant" }),
      ],
      [nameGrant({ name: "Ellie", amountCents: 3000, purpose: "Hardware Grant" })],
    );
    expect(preview.matches).toEqual([]);
    expect(preview.unusedGrants).toHaveLength(1);
    expect(preview.warnings[0]?.orderIds).toEqual([1, 2]);
  });

  test("does not auto-pair on amount/item alone", () => {
    const preview = matchGrantsToOrders(
      [order({ playerName: "Ellie Wen", amountCents: 3000, itemName: "Hardware Grant" })],
      [nameGrant({ name: "Unknown Person", amountCents: 3000, purpose: "Hardware Grant" })],
    );
    expect(preview.matches).toEqual([]);
    expect(preview.unusedGrants).toHaveLength(1);
    expect(preview.warnings[0]?.orderIds).toEqual([1]);
    expect(preview.warnings[0]?.reason).toContain("amount/item");
  });

  test("does not guess when several orders share the amount and item", () => {
    const preview = matchGrantsToOrders(
      [
        order({ orderId: 1, playerName: "Ellie Wen", amountCents: 3000, itemName: "Hardware Grant" }),
        order({ orderId: 2, playerName: "Dániel Tóth", amountCents: 3000, itemName: "Hardware Grant" }),
      ],
      [nameGrant({ name: "Unknown Person", amountCents: 3000, purpose: "Hardware Grant" })],
    );
    expect(preview.matches).toEqual([]);
    expect(preview.unusedGrants).toHaveLength(1);
    expect(preview.warnings[0]?.orderIds).toEqual([1, 2]);
  });

  test("returns only safe fields for the client", () => {
    const preview = matchGrantsToOrders([order()], [grant()]);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).toContain("https://hcb.hackclub.com/grants/abc");
  });
});
