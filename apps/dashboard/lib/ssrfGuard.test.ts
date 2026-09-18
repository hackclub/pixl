import { describe, expect, test } from "bun:test";
import { hostIsPublic, isBlockedIp, type LookupImpl } from "./ssrfGuard";

function lookupOf(...addrs: { address: string; family: number }[]): LookupImpl {
  return async () => addrs.map((a) => ({ ...a }));
}

describe("isBlockedIp", () => {
  const blocked = [
    "127.0.0.1", "127.0.0.53", "::1", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.254", "192.168.1.1", "192.168.0.0",
    "169.254.169.254", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::",
    "fe80::1", "fc00::1", "fd00::abcd", "::ffff:127.0.0.1", "::ffff:10.0.0.5",
  ];
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => expect(isBlockedIp(ip)).toBe(true));
  }

  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111"];
  for (const ip of allowed) {
    test(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }

  test("rejects a non-IP string rather than guessing", () => expect(isBlockedIp("not-an-ip")).toBe(true));
});

describe("hostIsPublic", () => {
  test("a hostname resolving to cloud metadata is rejected", async () => {
    const lookupImpl = lookupOf({ address: "169.254.169.254", family: 4 });
    expect(await hostIsPublic("attacker.example.test", { lookupImpl })).toBe(false);
  });

  test("an ordinary public hostname is allowed", async () => {
    const lookupImpl = lookupOf({ address: "93.184.216.34", family: 4 });
    expect(await hostIsPublic("example.test", { lookupImpl })).toBe(true);
  });

  test("rejects if ANY resolved address is internal, even alongside a public one", async () => {
    const lookupImpl = lookupOf({ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 });
    expect(await hostIsPublic("multi.example.test", { lookupImpl })).toBe(false);
  });

  test("a bare IP given directly as the hostname is checked without a DNS call", async () => {
    let called = false;
    const lookupImpl: LookupImpl = async () => {
      called = true;
      return [];
    };
    expect(await hostIsPublic("169.254.169.254", { lookupImpl })).toBe(false);
    expect(called).toBe(false);
  });

  test("a hostname that fails to resolve is not treated as public", async () => {
    const lookupImpl: LookupImpl = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await hostIsPublic("nonexistent.example.test", { lookupImpl })).toBe(false);
  });
});
