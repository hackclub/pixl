import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clientIpFrom, isCloudflareAddress, normalizeIp, rateLimitIpKey, requestIpKey } from "./clientIp.js";

const CF_PEER = "162.158.10.20";
const CF_PEER_V6 = "2606:4700:4700::1111";
const DIRECT_PEER = "198.51.100.7";

describe("clientIpFrom", () => {
  test("a forged CF-Connecting-IP from a non-Cloudflare peer is ignored", () => {
    expect(clientIpFrom({ xForwardedFor: DIRECT_PEER, cfConnectingIp: "203.0.113.9" })).toBe(DIRECT_PEER);
  });

  test("a valid CF-Connecting-IP from a Cloudflare peer is used", () => {
    expect(clientIpFrom({ xForwardedFor: CF_PEER, cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
    expect(clientIpFrom({ xForwardedFor: CF_PEER_V6, cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
  });

  test("a Cloudflare peer reported as an IPv4-mapped address is still recognised", () => {
    expect(clientIpFrom({ xForwardedFor: `::ffff:${CF_PEER}`, cfConnectingIp: "203.0.113.9" })).toBe("203.0.113.9");
  });

  test("garbage CF-Connecting-IP is ignored even from a Cloudflare peer", () => {
    for (const bad of ["aaaa", "", "<script>", "1.2.3.4, 5.6.7.8", "999.1.1.1", "fe80::1%eth0", "01.2.3.4", "1.2.3.4:80"]) {
      expect(clientIpFrom({ xForwardedFor: CF_PEER, cfConnectingIp: bad })).toBe(CF_PEER);
    }
  });

  test("an array-valued CF-Connecting-IP is ambiguous and ignored", () => {
    expect(clientIpFrom({ xForwardedFor: CF_PEER, cfConnectingIp: ["203.0.113.9", "9.9.9.9"] })).toBe(CF_PEER);
  });

  test("only the rightmost X-Forwarded-For entry (the ingress-observed peer) counts", () => {
    expect(clientIpFrom({ xForwardedFor: `9.9.9.9, 1.1.1.1, ${DIRECT_PEER}` })).toBe(DIRECT_PEER);
  });

  test("a client cannot claim to be Cloudflare by stuffing a Cloudflare IP into the left of X-Forwarded-For", () => {
    expect(
      clientIpFrom({ xForwardedFor: `${CF_PEER}, ${DIRECT_PEER}`, cfConnectingIp: "203.0.113.9" }),
    ).toBe(DIRECT_PEER);
  });

  test("falls back to the socket address when there is no X-Forwarded-For", () => {
    expect(clientIpFrom({ remoteAddress: "::ffff:198.51.100.7" })).toBe(DIRECT_PEER);
    expect(clientIpFrom({ remoteAddress: DIRECT_PEER, cfConnectingIp: "203.0.113.9" })).toBe(DIRECT_PEER);
  });

  test("returns a stable opaque value when nothing usable is present", () => {
    expect(clientIpFrom({})).toBe("unknown");
    expect(clientIpFrom({ xForwardedFor: "garbage" })).toBe("unknown");
  });
});

describe("isCloudflareAddress", () => {
  test("matches published ranges and rejects neighbours", () => {
    expect(isCloudflareAddress("104.16.0.1")).toBe(true);
    expect(isCloudflareAddress("103.21.244.255")).toBe(true);
    expect(isCloudflareAddress("2400:cb00:1::1")).toBe(true);
    expect(isCloudflareAddress("104.15.255.255")).toBe(false);
    expect(isCloudflareAddress("8.8.8.8")).toBe(false);
    expect(isCloudflareAddress("2001:db8::1")).toBe(false);
    expect(isCloudflareAddress("nope")).toBe(false);
  });
});

describe("rateLimitIpKey", () => {
  test("IPv4 addresses are used as-is", () => {
    expect(rateLimitIpKey("203.0.113.9")).toBe("203.0.113.9");
  });

  test("different IPv4-mapped IPv6 addresses do not collapse", () => {
    const a = rateLimitIpKey("::ffff:1.2.3.4");
    const b = rateLimitIpKey("::ffff:9.9.9.9");
    expect(a).not.toBe(b);
    expect(a).toBe("1.2.3.4");
    expect(b).toBe("9.9.9.9");
  });

  test("an IPv4-mapped address shares its identity with the plain IPv4 address", () => {
    expect(rateLimitIpKey("::FFFF:1.2.3.4")).toBe(rateLimitIpKey("1.2.3.4"));
    expect(rateLimitIpKey("::ffff:102:304")).toBe(rateLimitIpKey("1.2.3.4"));
    expect(rateLimitIpKey("0:0:0:0:0:ffff:1.2.3.4")).toBe(rateLimitIpKey("1.2.3.4"));
  });

  test("equivalent IPv6 spellings map to the same key", () => {
    const spellings = [
      "2001:db8:1234:5678::1",
      "2001:0db8:1234:5678:0000:0000:0000:0001",
      "2001:DB8:1234:5678:0:0:0:1",
      "2001:db8:1234:5678:0::1",
    ];
    const keys = new Set(spellings.map(rateLimitIpKey));
    expect(keys.size).toBe(1);
  });

  test("two IPv6 addresses in the same /64 collapse to the same key", () => {
    expect(rateLimitIpKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd")).toBe(
      rateLimitIpKey("2001:db8:1234:5678:1111:2222:3333:4444"),
    );
  });

  test("two IPv6 addresses in different /64s do not collapse", () => {
    expect(rateLimitIpKey("2001:db8:1234:5678::1")).not.toBe(rateLimitIpKey("2001:db8:1234:5679::1"));
  });

  test("handles compressed and loopback addresses", () => {
    expect(rateLimitIpKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(() => rateLimitIpKey("::1")).not.toThrow();
  });

  test("a non-IP value collapses to one opaque key", () => {
    expect(rateLimitIpKey("unknown")).toBe("unknown");
    expect(rateLimitIpKey("<script>")).toBe("unknown");
  });
});

describe("normalizeIp", () => {
  test("rejects zone ids, ports and leading-zero octets", () => {
    expect(normalizeIp("fe80::1%eth0")).toBeNull();
    expect(normalizeIp("1.2.3.4:80")).toBeNull();
    expect(normalizeIp("01.2.3.4")).toBeNull();
  });
});

describe("requestIpKey", () => {
  test("reads the same inputs off a Node request", () => {
    const req = {
      headers: { "x-forwarded-for": CF_PEER, "cf-connecting-ip": "2001:db8::5" },
      socket: { remoteAddress: "10.1.2.3" },
    };
    expect(requestIpKey(req)).toBe("2001:db8:0:0::/64");
    expect(requestIpKey({ ...req, headers: { ...req.headers, "x-forwarded-for": DIRECT_PEER } })).toBe(DIRECT_PEER);
  });
});

describe("landing copy", () => {
  test("apps/landing/lib/clientIp.ts is byte-identical to this module", () => {
    const server = readFileSync(new URL("./clientIp.ts", import.meta.url), "utf8");
    const landing = readFileSync(new URL("../../landing/lib/clientIp.ts", import.meta.url), "utf8");
    expect(landing).toBe(server);
  });
});
