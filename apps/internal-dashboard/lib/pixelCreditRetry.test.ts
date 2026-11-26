import { describe, expect, test } from "bun:test";
import { retryProjectPixelCredit } from "./pixelCreditRetry";

describe("retryProjectPixelCredit", () => {
  test("credits once when the first RPC succeeds", async () => {
    let attempts = 0;
    await retryProjectPixelCredit(async () => {
      attempts++;
      return { error: null };
    }, async () => {});
    expect(attempts).toBe(1);
  });

  test("retries an idempotent credit after a database error", async () => {
    let attempts = 0;
    const waits: number[] = [];
    await retryProjectPixelCredit(async () => ({
      error: ++attempts === 1 ? { message: "transient connection" } : null,
    }), async (ms) => { waits.push(ms); });
    expect(attempts).toBe(2);
    expect(waits).toEqual([100]);
  });

  test("fails loudly after all retries, never reporting an unpaid credit as success", async () => {
    let attempts = 0;
    await expect(retryProjectPixelCredit(async () => {
      attempts++;
      return { error: { message: "database unavailable" } };
    }, async () => {})).rejects.toThrow("database unavailable");
    expect(attempts).toBe(3);
  });

  test("retries a thrown transport error", async () => {
    let attempts = 0;
    await retryProjectPixelCredit(async () => {
      if (++attempts === 1) throw new Error("network reset");
      return { error: null };
    }, async () => {});
    expect(attempts).toBe(2);
  });
});
