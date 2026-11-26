import { describe, expect, test } from "bun:test";
import { createConcurrencyLimiter } from "./concurrency";

describe("createConcurrencyLimiter", () => {
  test("never runs more than the configured limit", async () => {
    const limit = createConcurrencyLimiter(3);
    let active = 0;
    let maxActive = 0;
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        limit(async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 2));
          active--;
          return i;
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(maxActive).toBe(3);
    expect(active).toBe(0);
  });

  test("releases a slot after a rejected request", async () => {
    const limit = createConcurrencyLimiter(1);
    const results = await Promise.allSettled([
      limit(async () => { throw new Error("remote failure"); }),
      limit(async () => "recovered"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "recovered" });
  });

  test("rejects invalid concurrency limits", () => {
    expect(() => createConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => createConcurrencyLimiter(1.5)).toThrow(RangeError);
  });
});
