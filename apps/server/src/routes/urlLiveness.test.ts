import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostIsPublic, isBlockedIp, isTrustedUnfetchableHost, urlAlive, type LookupImpl } from "./urlLiveness.js";

// local servers only, no real DNS
function lookupOf(...addrs: { address: string; family: number }[]): LookupImpl {
  return async () => addrs.map((a) => ({ ...a }));
}

// fresh copy per call, no shared array
function sequencedLookup(...answers: { address: string; family: number }[][]) {
  const calls: string[] = [];
  const impl: LookupImpl = async (hostname) => {
    const answer = answers[Math.min(calls.length, answers.length - 1)];
    calls.push(hostname);
    return answer.map((a) => ({ ...a }));
  };
  return { impl, calls };
}

const allowAll = () => false;

function startServer(handler: http.RequestListener): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "::", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, hits: () => hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe("isBlockedIp", () => {
  const blocked = ["127.0.0.1", "127.0.0.53", "::1", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1", "192.168.0.0", "169.254.169.254", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::", "fe80::1", "fc00::1", "fd00::abcd", "::ffff:127.0.0.1", "::ffff:10.0.0.5"];
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
  test("localhost is blocked", async () => {
    const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 });
    expect(await hostIsPublic("localhost", { lookupImpl })).toBe(false);
  });

  test("127.0.0.1 given directly as the hostname is blocked, no DNS call needed", async () => {
    const { impl, calls } = sequencedLookup([]);
    expect(await hostIsPublic("127.0.0.1", { lookupImpl: impl })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("::1 given directly as the hostname is blocked", async () => {
    expect(await hostIsPublic("::1")).toBe(false);
  });

  test("an ordinary public hostname is allowed", async () => {
    const lookupImpl = lookupOf({ address: "93.184.216.34", family: 4 });
    expect(await hostIsPublic("example.test", { lookupImpl })).toBe(true);
  });

  test("an allowed-looking hostname that resolves directly to a blocked IP is rejected", async () => {
    const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
    expect(await hostIsPublic("sneaky.example.test", { lookupImpl })).toBe(false);
  });

  test("rejects if ANY resolved address is internal, even alongside a public one", async () => {
    const lookupImpl = lookupOf({ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 });
    expect(await hostIsPublic("multi.example.test", { lookupImpl })).toBe(false);
  });

  test("rejects a hostname that resolves to nothing", async () => {
    const lookupImpl: LookupImpl = async () => [];
    expect(await hostIsPublic("nowhere.example.test", { lookupImpl })).toBe(false);
  });

  test("rejects a hostname whose lookup throws", async () => {
    const lookupImpl: LookupImpl = async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await hostIsPublic("nxdomain.example.test", { lookupImpl })).toBe(false);
  });
});

describe("isTrustedUnfetchableHost", () => {
  test("roblox.com is trusted", () => expect(isTrustedUnfetchableHost("roblox.com")).toBe(true));
  test("www.roblox.com is trusted (www stripped)", () => expect(isTrustedUnfetchableHost("www.roblox.com")).toBe(true));
  test("an unrelated host is not trusted", () => expect(isTrustedUnfetchableHost("example.com")).toBe(false));
});

describe("urlAlive - basic reachability", () => {
  test("a normal public HTTP host is allowed", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://public-host.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a non-2xx/401/403 status is not alive", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(500).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://error-host.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(false);
    } finally {
      await close();
    }
  });

  for (const status of [401, 403]) {
    test(`${status} still counts as "alive"`, async () => {
      const { port, close } = await startServer((_req, res) => res.writeHead(status).end());
      try {
        const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
        expect(await urlAlive(`http://auth-host.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
      } finally {
        await close();
      }
    });
  }

  for (const status of [405, 501]) {
    test(`HEAD ${status} falls back to GET, using the same pinned lookup`, async () => {
      const { impl: lookupImpl, calls } = sequencedLookup([{ address: "127.0.0.1", family: 4 }]);
      const methodsSeen: string[] = [];
      const { port, close } = await startServer((req, res) => {
        methodsSeen.push(req.method ?? "");
        if (req.method === "HEAD") return void res.writeHead(status).end();
        res.writeHead(200).end("ok");
      });
      try {
        expect(await urlAlive(`http://fallback-host.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
        expect(methodsSeen).toEqual(["HEAD", "GET"]);
        expect(calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        await close();
      }
    });
  }
});

describe("urlAlive - redirects", () => {
  test("follows a redirect chain to a final 200, re-validating the host at every hop", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/start") return void res.writeHead(302, { location: "/next" }).end();
      if (req.url === "/next") return void res.writeHead(302, { location: "/done" }).end();
      res.writeHead(200).end("ok");
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://redirect-host.test:${port}/start`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a redirect with no location header is not alive", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(302).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://bare-redirect.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(false);
    } finally {
      await close();
    }
  });

  test("a redirect to a blocked/private destination is rejected", async () => {
    const { port, close } = await startServer((_req, res) =>
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end(),
    );
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const isBlocked = (ip: string) => ip === "169.254.169.254";
      expect(await urlAlive(`http://redirect-to-metadata.test:${port}/`, { lookupImpl, isBlockedIp: isBlocked })).toBe(false);
    } finally {
      await close();
    }
  });

  test("a redirect loop is capped at 5 hops instead of hanging", async () => {
    const { port, close, hits } = await startServer((_req, res) => res.writeHead(302, { location: "/" }).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const result = await urlAlive(`http://redirect-loop.test:${port}/`, { lookupImpl, isBlockedIp: allowAll });
      expect(result).toBe(false);
      expect(hits()).toBe(5);
    } finally {
      await close();
    }
  });

  // Streamlit Community Cloud: / bounces through an auth hop to /-/login, which
  // sets a session cookie and sends you back to /. Without carrying the cookie
  // it loops forever and every Streamlit demo read as unreachable.
  test("carries cookies across hops so a cookie-gated auth bounce resolves", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/-/auth") return void res.writeHead(303, { location: "/-/login" }).end();
      if (req.url === "/-/login")
        return void res.writeHead(303, { location: "/", "set-cookie": "session=abc; Path=/; HttpOnly" }).end();
      if (req.headers.cookie?.includes("session=abc")) return void res.writeHead(200).end("ok");
      res.writeHead(303, { location: "/-/auth", "set-cookie": "session=; Path=/; Max-Age=0" }).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://cookie-bounce.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("cookies set by one host are not sent to a different host", async () => {
    const cookiesSeen: (string | undefined)[] = [];
    const { port, close } = await startServer((req, res) => {
      if (req.headers.host?.startsWith("first.test"))
        return void res.writeHead(302, { location: `http://second.test:${port}/`, "set-cookie": "secret=1" }).end();
      cookiesSeen.push(req.headers.cookie);
      res.writeHead(200).end("ok");
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://first.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
      expect(cookiesSeen).toEqual([undefined]);
    } finally {
      await close();
    }
  });
});

describe("urlAlive - address selection (IPv4/IPv6/multi-address)", () => {
  test("an IPv4-only host is reachable", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://ipv4-only.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("an IPv6-only host is reachable", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      const lookupImpl = lookupOf({ address: "::1", family: 6 });
      expect(await urlAlive(`http://ipv6-only.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a mixed IPv4/IPv6 host is reachable", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 });
      expect(await urlAlive(`http://dual-stack.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a host with multiple addresses where the first fails is still reachable via the second", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      // 127.0.0.2 refuses fast, not a blackhole - reliable under Bun and Node
      const lookupImpl = lookupOf({ address: "127.0.0.2", family: 4 }, { address: "127.0.0.1", family: 4 });
      expect(await urlAlive(`http://multi-addr.test:${port}/`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });
});

describe("urlAlive - DNS-rebinding regression", () => {
  test("a resolution that only turns blocked at connect time is still caught, the internal target is never contacted", async () => {
    let canaryHits = 0;
    const canary = http.createServer((_req, res) => {
      canaryHits++;
      res.writeHead(200).end("should never be reached");
    });
    const canaryPort = await new Promise<number>((resolve, reject) => {
      canary.on("error", reject);
      canary.listen(0, "127.0.0.1", () => resolve((canary.address() as AddressInfo).port));
    });
    try {
      let calls = 0;
      const lookupImpl: LookupImpl = async () => {
        calls++;
        // pre-check sees "public"
        if (calls === 1) return [{ address: "203.0.113.10", family: 4 }];
        // connect-time sees the rebind
        return [{ address: "127.0.0.1", family: 4 }];
      };
      const alive = await urlAlive(`http://rebind-attacker.test:${canaryPort}/`, { lookupImpl });
      expect(alive).toBe(false);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(canaryHits).toBe(0);
    } finally {
      await new Promise((r) => canary.close(r));
    }
  });

  test("connect-time resolution is freshly re-resolved, not the pre-check's answer reused", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(200).end("ok"));
    try {
      let calls = 0;
      const lookupImpl: LookupImpl = async () => {
        calls++;
        // dead address, pre-check only
        if (calls === 1) return [{ address: "203.0.113.10", family: 4 }];
        // real server, connect-time
        return [{ address: "127.0.0.1", family: 4 }];
      };
      const alive = await urlAlive(`http://rebind-precheck.test:${port}/`, {
        lookupImpl,
        isBlockedIp: allowAll,
        timeoutMs: 2000,
      });
      expect(alive).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      await close();
    }
  });
});

// throwaway cert, skips if no openssl
let httpsFixture: { key: string; cert: string } | null = null;
try {
  const dir = mkdtempSync(path.join(os.tmpdir(), "urlliveness-cert-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-nodes", "-subj", "/CN=secure-host.test",
      "-addext", "subjectAltName=DNS:secure-host.test",
    ],
    { stdio: "ignore" },
  );
  httpsFixture = { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  rmSync(dir, { recursive: true, force: true });
} catch {
  httpsFixture = null;
}

const httpsTest = httpsFixture ? test : test.skip;

describe("urlAlive - HTTPS with pinned DNS", () => {
  httpsTest("a normal public HTTPS host is allowed, certificate validated against the pinned hostname", async () => {
    const server = https.createServer({ key: httpsFixture!.key, cert: httpsFixture!.cert }, (_req, res) => {
      res.writeHead(200).end("ok");
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "::", () => resolve((server.address() as AddressInfo).port));
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const alive = await urlAlive(`https://secure-host.test:${port}/`, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(alive).toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  httpsTest("certificate validation still fails for a hostname the cert doesn't cover, even with DNS pinned", async () => {
    const server = https.createServer({ key: httpsFixture!.key, cert: httpsFixture!.cert }, (_req, res) => {
      res.writeHead(200).end("ok");
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "::", () => resolve((server.address() as AddressInfo).port));
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const alive = await urlAlive(`https://wrong-host.test:${port}/`, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(alive).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
