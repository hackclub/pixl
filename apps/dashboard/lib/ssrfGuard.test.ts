import { describe, expect, test } from "bun:test";
import { hostIsPublic, isBlockedIp, safeJsonGet, type LookupImpl } from "./ssrfGuard";
import { startHttpServer, startHttpsServer, tlsFixture, type Handler } from "./testTls";

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

describe("safeJsonGet credential handling", () => {
  const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
  const guard = { lookupImpl, isBlockedIp: () => false, ca: tlsFixture.cert };
  const CANARY = "token canary-secret";

  function recorder() {
    const seen: Record<string, string | undefined>[] = [];
    const handler: Handler = (req, res) => {
      seen.push({ authorization: req.headers.authorization, privateToken: req.headers["private-token"] as string | undefined });
      res.writeHead(200, { "content-type": "application/json" }).end("[]");
    };
    return { seen, handler };
  }

  const redirectTo = (location: (req: import("node:http").IncomingMessage) => string): Handler => (req, res) => {
    res.writeHead(302, { location: location(req) }).end();
  };

  test("sends credentials to the first origin over https", async () => {
    const r = recorder();
    const a = await startHttpsServer(r.handler);
    try {
      const out = await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { Authorization: CANARY }, guard);
      expect(out?.status).toBe(200);
      expect(r.seen[0].authorization).toBe(CANARY);
    } finally {
      await a.close();
    }
  });

  test("drops Authorization and PRIVATE-TOKEN when a redirect changes host", async () => {
    const r = recorder();
    const b = await startHttpsServer(r.handler);
    const a = await startHttpsServer(redirectTo(() => `https://blog.example.test:${b.port}/y`));
    try {
      const out = await safeJsonGet(
        `https://gitea.example.test:${a.port}/x`,
        { Authorization: CANARY, "PRIVATE-TOKEN": "glpat-canary", Accept: "application/json" },
        guard,
      );
      expect(out?.status).toBe(200);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0].authorization).toBeUndefined();
      expect(r.seen[0].privateToken).toBeUndefined();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("drops credentials when only the port changes", async () => {
    const r = recorder();
    const b = await startHttpsServer(r.handler);
    const a = await startHttpsServer(redirectTo(() => `https://gitea.example.test:${b.port}/y`));
    try {
      await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { authorization: CANARY }, guard);
      expect(r.seen[0].authorization).toBeUndefined();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("keeps credentials on a same-origin redirect", async () => {
    const r = recorder();
    let hits = 0;
    const a = await startHttpsServer((req, res) => {
      hits++;
      if (req.url === "/x") return res.writeHead(302, { location: "/y" }).end();
      r.handler(req, res);
    });
    try {
      await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { Authorization: CANARY }, guard);
      expect(hits).toBe(2);
      expect(r.seen[0].authorization).toBe(CANARY);
    } finally {
      await a.close();
    }
  });

  test("does not hand credentials back when a redirect chain returns to the first origin", async () => {
    const r = recorder();
    let a!: Awaited<ReturnType<typeof startHttpsServer>>;
    const b = await startHttpsServer((req, res) => {
      res.writeHead(302, { location: `https://gitea.example.test:${a.port}/back` }).end();
    });
    a = await startHttpsServer((req, res) => {
      if (req.url === "/back") return r.handler(req, res);
      res.writeHead(302, { location: `https://blog.example.test:${b.port}/hop` }).end();
    });
    try {
      await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { Authorization: CANARY }, guard);
      expect(r.seen).toHaveLength(1);
      expect(r.seen[0].authorization).toBeUndefined();
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("refuses an https to http redirect for an authenticated request", async () => {
    const r = recorder();
    const b = await startHttpServer(r.handler);
    const a = await startHttpsServer(redirectTo(() => `http://gitea.example.test:${b.port}/y`));
    try {
      const out = await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { Authorization: CANARY }, guard);
      expect(out).toBeNull();
      expect(r.seen).toHaveLength(0);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("refuses to send credentials over plain http at all", async () => {
    const r = recorder();
    const a = await startHttpServer(r.handler);
    try {
      const out = await safeJsonGet(`http://gitea.example.test:${a.port}/x`, { Authorization: CANARY }, guard);
      expect(out).toBeNull();
      expect(r.seen).toHaveLength(0);
    } finally {
      await a.close();
    }
  });

  test("an unauthenticated request may still follow https to http", async () => {
    const r = recorder();
    const b = await startHttpServer(r.handler);
    const a = await startHttpsServer(redirectTo(() => `http://gitea.example.test:${b.port}/y`));
    try {
      const out = await safeJsonGet(`https://gitea.example.test:${a.port}/x`, { Accept: "application/json" }, guard);
      expect(out?.status).toBe(200);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("still refuses a redirect into a blocked address", async () => {
    const a = await startHttpsServer(redirectTo(() => "https://internal.example.test/y"));
    try {
      const out = await safeJsonGet(
        `https://gitea.example.test:${a.port}/x`,
        { Authorization: CANARY },
        {
          ca: tlsFixture.cert,
          lookupImpl: async (host) => [
            host === "internal.example.test" ? { address: "10.0.0.5", family: 4 } : { address: "127.0.0.1", family: 4 },
          ],
          isBlockedIp: (ip) => ip !== "127.0.0.1",
        },
      );
      expect(out).toBeNull();
    } finally {
      await a.close();
    }
  });
});
