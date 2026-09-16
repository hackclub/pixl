import { expect, test } from "bun:test";
import { consumeRateLimit } from "../rateLimit.js";
import { validateBomCsv } from "./bomCsv.js";

test("accepts a structured BOM CSV", () => {
  const result = validateBomCsv(Buffer.from("Part,Quantity\nResistor,4\n"));

  expect(result).toEqual({ ok: true });
});

test("rejects binary data masquerading as a CSV", () => {
  const result = validateBomCsv(Buffer.from([0x50, 0x61, 0x72, 0x74, 0, 0x31]));

  expect(result).toEqual({ ok: false, error: "invalid_csv" });
});

test("rejects unstructured CSV data", () => {
  const result = validateBomCsv(Buffer.from("this is not a bill of materials\n"));

  expect(result).toEqual({ ok: false, error: "invalid_csv" });
});

test("limits one authenticated account without limiting another", () => {
  const limit = { windowMs: 60_000, max: 1, name: `bom-test-${Date.now()}` };

  expect(consumeRateLimit(limit, "owner-a")).toBeNull();
  expect(consumeRateLimit(limit, "owner-a")).toBeGreaterThan(0);
  expect(consumeRateLimit(limit, "owner-b")).toBeNull();
});
