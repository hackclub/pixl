import { describe, expect, test } from "bun:test";
import { realIpFromHeaders, rateLimitIpKey } from "./clientIp.js";

describe("realIpFromHeaders", () => {
  test("prefers CF-Connecting-IP over any fallback", () => {
    expect(realIpFromHeaders({ "cf-connecting-ip": "203.0.113.9" }, "10.0.0.5")).toBe("203.0.113.9");
  });

  test("falls back when CF-Connecting-IP is absent", () => {
    expect(realIpFromHeaders({}, "10.0.0.5")).toBe("10.0.0.5");
  });

  test("ignores a garbage/empty CF-Connecting-IP value", () => {
    expect(realIpFromHeaders({ "cf-connecting-ip": "" }, "10.0.0.5")).toBe("10.0.0.5");
    expect(realIpFromHeaders({ "cf-connecting-ip": "<script>" }, "10.0.0.5")).toBe("10.0.0.5");
  });

  test("takes the first value if somehow given an array (Node can produce these)", () => {
    expect(realIpFromHeaders({ "cf-connecting-ip": ["198.51.100.1", "9.9.9.9"] }, "fallback")).toBe(
      "198.51.100.1",
    );
  });
});

describe("rateLimitIpKey", () => {
  test("IPv4 addresses are used as-is - the full address is already the right unit", () => {
    expect(rateLimitIpKey("203.0.113.9")).toBe("203.0.113.9");
  });

  test("two IPv6 addresses in the same /64 collapse to the same key", () => {
    const a = rateLimitIpKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    const b = rateLimitIpKey("2001:db8:1234:5678:1111:2222:3333:4444");
    expect(a).toBe(b);
  });

  test("two IPv6 addresses in different /64s do not collapse", () => {
    const a = rateLimitIpKey("2001:db8:1234:5678::1");
    const b = rateLimitIpKey("2001:db8:1234:5679::1");
    expect(a).not.toBe(b);
  });

  test("handles a fully compressed address", () => {
    expect(rateLimitIpKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  test("loopback still resolves to a stable key rather than throwing", () => {
    expect(() => rateLimitIpKey("::1")).not.toThrow();
  });

  test("an opaque non-IP fallback value ('unknown') passes through unchanged", () => {
    expect(rateLimitIpKey("unknown")).toBe("unknown");
  });
});
