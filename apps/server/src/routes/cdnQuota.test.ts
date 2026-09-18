import { describe, expect, test } from "bun:test";
import { reserveCdnUploadQuota, releaseCdnUploadQuota } from "./cdnQuota.js";

function opts(overrides: Partial<Parameters<typeof reserveCdnUploadQuota>[0]> = {}) {
  return {
    windowMs: 60_000,
    maxRequests: 3,
    maxBytes: 1000,
    name: `cdn-quota-test-${Date.now()}-${Math.random()}`,
    ...overrides,
  };
}

describe("reserveCdnUploadQuota", () => {
  test("allows uploads under both the request and byte caps", () => {
    const o = opts();
    const user = "user-a";
    expect(reserveCdnUploadQuota(o, user, 100)).toEqual({ ok: true });
    expect(reserveCdnUploadQuota(o, user, 100)).toEqual({ ok: true });
  });

  test("blocks once the request count cap is hit", () => {
    const o = opts({ maxRequests: 2, maxBytes: 1_000_000 });
    const user = "user-b";
    expect(reserveCdnUploadQuota(o, user, 1)).toEqual({ ok: true });
    expect(reserveCdnUploadQuota(o, user, 1)).toEqual({ ok: true });
    const third = reserveCdnUploadQuota(o, user, 1);
    expect(third.ok).toBe(false);
  });

  test("blocks once the byte cap is hit, even under the request cap", () => {
    const o = opts({ maxRequests: 1_000, maxBytes: 500 });
    const user = "user-c";
    expect(reserveCdnUploadQuota(o, user, 400)).toEqual({ ok: true });
    const second = reserveCdnUploadQuota(o, user, 200);
    expect(second.ok).toBe(false);
  });

  test("one user's usage never counts against another user's quota", () => {
    const o = opts({ maxRequests: 1, maxBytes: 1_000_000 });
    expect(reserveCdnUploadQuota(o, "user-d", 1)).toEqual({ ok: true });
    expect(reserveCdnUploadQuota(o, "user-e", 1)).toEqual({ ok: true });
  });

  test("concurrent reservations against the same budget never oversell it", () => {
    const o = opts({ maxRequests: 1_000, maxBytes: 500 });
    const user = "user-f";
    const results = Array.from({ length: 10 }, () => reserveCdnUploadQuota(o, user, 100));
    const granted = results.filter((r) => r.ok).length;
    expect(granted).toBe(5);
  });

  test("releasing a reservation frees both the request and byte budget back up", () => {
    const o = opts({ maxRequests: 1, maxBytes: 100 });
    const user = "user-g";
    expect(reserveCdnUploadQuota(o, user, 100)).toEqual({ ok: true });
    expect(reserveCdnUploadQuota(o, user, 100).ok).toBe(false);

    releaseCdnUploadQuota(o, user, 100);

    expect(reserveCdnUploadQuota(o, user, 100)).toEqual({ ok: true });
  });

  test("releasing never drives usage negative", () => {
    const o = opts();
    const user = "user-h";
    releaseCdnUploadQuota(o, user, 100);
    expect(reserveCdnUploadQuota(o, user, o.maxBytes)).toEqual({ ok: true });
  });
});
