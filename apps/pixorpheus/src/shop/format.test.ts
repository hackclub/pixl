import { describe, expect, test } from "bun:test";
import { diffLines, render, requestIdFrom, RecentIds, type ShopRow } from "./format.js";

const base: ShopRow = {
  id: 1,
  name: "Sticker pack",
  description: "Nice stickers",
  price: 100,
  image_url: "",
  options: null,
  active: true,
  position: 0,
  created_by: "x",
};

describe("shop notifications escape admin-authored text", () => {
  test("names in an INSERT/DELETE/UPDATE message cannot ping or link", () => {
    const name = "<!channel> free <https://evil.com|robux> <@U0ABC12345>";
    for (const kind of ["INSERT", "DELETE", "UPDATE"] as const) {
      const out = render({ kind, name, regions: new Set(["US"]), lines: [], prices: new Map([["US", 5]]) });
      expect(out).not.toContain("<!");
      expect(out).not.toContain("<http");
      expect(out).not.toContain("<@");
      expect(out).toContain("&lt;!channel&gt;");
    }
  });

  test("region codes are escaped and cannot break out of backticks", () => {
    const out = render({ kind: "DELETE", name: "x", regions: new Set(["`<!here>`"]), lines: [], prices: new Map() });
    expect(out).not.toContain("<!here>");
    expect(out).toContain("`&lt;!here&gt;`");
  });

  test("diff lines escape names, descriptions and lock notes", () => {
    const lines = diffLines(base, {
      ...base,
      name: "<!everyone>",
      description: "<mailto:a@b.co|support>",
      manual_locked: true,
      lock_note: "<!subteam^S1|@ops>",
    }).join("\n");
    expect(lines).not.toMatch(/<[!@#a-z]/i);
    expect(lines).toContain("&lt;!everyone&gt;");
  });

  test("non-numeric prices and positions never reach mrkdwn", () => {
    const lines = diffLines(base, { ...base, price: "<!channel>" as unknown as number, position: "<!here>" as unknown as number });
    expect(lines.join("\n")).not.toContain("<!");
  });

  test("sale end changes are announced as an explicit UTC instant", () => {
    const lines = diffLines(
      { ...base, discount_percent: 20 },
      { ...base, discount_percent: 20, discount_ends_at: "2026-11-30T18:00:00.000Z" },
    );
    expect(lines).toContain("• 🏷️ sale ends: 2026-11-30 18:00 UTC");
    expect(diffLines({ ...base, discount_percent: 20, discount_ends_at: "2026-11-30T18:00:00.000Z" }, { ...base, discount_percent: 20 })).toContain(
      "• sale end removed",
    );
  });
});

describe("request id dedup", () => {
  test("takes the first valid id from headers or body", () => {
    expect(requestIdFrom({ "x-pixl-request-id": "abc-123" }, {})).toBe("abc-123");
    expect(requestIdFrom({}, { request_id: "r1" })).toBe("r1");
    expect(requestIdFrom({ "x-request-id": "bad id with spaces" }, {})).toBeNull();
    expect(requestIdFrom({}, null)).toBeNull();
  });

  test("an id is processed once within the TTL", () => {
    const ids = new RecentIds(1000, 10);
    expect(ids.checkAndRecord("a", 0)).toBe(false);
    expect(ids.checkAndRecord("a", 500)).toBe(true);
    expect(ids.checkAndRecord("a", 1500)).toBe(false);
  });

  test("bounded memory", () => {
    const ids = new RecentIds(60_000, 3);
    for (let i = 0; i < 10; i++) ids.checkAndRecord(`id${i}`, i);
    expect(ids.checkAndRecord("id9", 20)).toBe(true);
    expect(ids.checkAndRecord("id0", 20)).toBe(false);
  });
});
