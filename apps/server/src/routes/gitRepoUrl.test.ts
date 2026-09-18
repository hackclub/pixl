import { describe, expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LookupImpl } from "./urlLiveness.js";
import {
  gitDiscoveryUrl,
  isGitRepoUrl,
  isKnownForgeHost,
  looksLikeGitAdvertisement,
  parseRepoUrl,
} from "./gitRepoUrl.js";

const ADVERT = "001e# service=git-upload-pack\n0000";

// local servers only, no real DNS
function lookupOf(...addrs: { address: string; family: number }[]): LookupImpl {
  return async () => addrs.map((a) => ({ ...a }));
}

// proves a code path never reached the network
const neverLookup: LookupImpl = async () => {
  throw new Error("should not be called");
};

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

describe("parseRepoUrl", () => {
  test("rejects a non-http scheme", () => expect(parseRepoUrl("javascript:alert(1)")).toBeNull());
  test("rejects garbage", () => expect(parseRepoUrl("not a url")).toBeNull());
  test("rejects a bare origin", () => expect(parseRepoUrl("https://codeberg.org")).toBeNull());
  test("accepts a repo path", () => expect(parseRepoUrl("https://codeberg.org/a/b")?.hostname).toBe("codeberg.org"));
});

describe("isKnownForgeHost", () => {
  for (const h of ["github.com", "www.github.com", "GitHub.com", "codeberg.org", "gitlab.com", "git.sr.ht"]) {
    test(`knows ${h}`, () => expect(isKnownForgeHost(h)).toBe(true));
  }
  test("does not know a random host", () => expect(isKnownForgeHost("example.com")).toBe(false));
});

describe("gitDiscoveryUrl", () => {
  test("appends the discovery path", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
  test("tolerates a trailing slash", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing/"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
  test("drops an existing query and fragment", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing?tab=x#readme"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
});

describe("looksLikeGitAdvertisement", () => {
  test("smart http content type", () =>
    expect(looksLikeGitAdvertisement("application/x-git-upload-pack-advertisement", "")).toBe(true));
  test("smart http pkt-line body", () => expect(looksLikeGitAdvertisement("text/plain", ADVERT)).toBe(true));
  test("dumb http refs file", () =>
    expect(looksLikeGitAdvertisement("text/plain", "9f2c1a4b8e7d6c5b4a39281706f5e4d3c2b1a099\trefs/heads/main")).toBe(true));
  test("an html page is not a repo", () =>
    expect(looksLikeGitAdvertisement("text/html", "<!doctype html><html>")).toBe(false));
});

describe("isGitRepoUrl", () => {
  test("github still passes with no network call", async () => {
    expect(await isGitRepoUrl("https://github.com/ridit/pixl", { lookupImpl: neverLookup })).toBe(true);
  });

  test("github user page without a repo is still rejected", async () => {
    expect(await isGitRepoUrl("https://github.com/ridit", { lookupImpl: neverLookup })).toBe(false);
  });

  test("codeberg passes, the thing issue #28 was about", async () => {
    expect(await isGitRepoUrl("https://codeberg.org/brandt/thing", { lookupImpl: neverLookup })).toBe(true);
  });

  test("a self-hosted forgejo answers discovery and passes", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/me/thing/info/refs?service=git-upload-pack") {
        res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement" }).end(ADVERT);
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://git.example.com:${port}/me/thing`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a dumb http host serving a refs file passes", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/thing.git/info/refs?service=git-upload-pack") {
        res.writeHead(200, { "content-type": "text/plain" }).end("9f2c1a4b8e7d6c5b4a39281706f5e4d3c2b1a099\trefs/heads/main\n");
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://cgit.example.com:${port}/thing.git`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a plain website is rejected", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/blog/post/info/refs?service=git-upload-pack") {
        res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html>not a repo</html>");
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://example.com:${port}/blog/post`, { lookupImpl, isBlockedIp: allowAll })).toBe(false);
    } finally {
      await close();
    }
  });

  test("a 404 from the discovery endpoint is rejected", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(404).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://example.com:${port}/nope`, { lookupImpl, isBlockedIp: allowAll })).toBe(false);
    } finally {
      await close();
    }
  });

  test("follows a redirect and still accepts", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/me/thing/info/refs?service=git-upload-pack") {
        res.writeHead(302, { location: "/me/thing/info/refs2?service=git-upload-pack" }).end();
        return;
      }
      if (req.url === "/me/thing/info/refs2?service=git-upload-pack") {
        res.writeHead(200, { "content-type": "application/x-git-upload-pack-advertisement" }).end(ADVERT);
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://git.example.com:${port}/me/thing`, { lookupImpl, isBlockedIp: allowAll })).toBe(true);
    } finally {
      await close();
    }
  });

  test("a redirect to an internal address is blocked", async () => {
    const { port, close } = await startServer((_req, res) =>
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end(),
    );
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const isBlocked = (ip: string) => ip === "169.254.169.254";
      expect(await isGitRepoUrl(`http://git.example.com:${port}/me/thing`, { lookupImpl, isBlockedIp: isBlocked })).toBe(false);
    } finally {
      await close();
    }
  });

  test("an internal host is never fetched at all", async () => {
    let calls = 0;
    const lookupImpl: LookupImpl = async () => {
      calls++;
      return [{ address: "127.0.0.1", family: 4 }];
    };
    expect(await isGitRepoUrl("http://localhost:3000/x/y", { lookupImpl })).toBe(false);
    expect(calls).toBe(1); // only the pre-check, no request attempted
  });

  test("a dangerous scheme never reaches the probe", async () => {
    expect(await isGitRepoUrl("javascript:alert(1)", { lookupImpl: neverLookup })).toBe(false);
  });

  test("a redirect loop gives up instead of hanging", async () => {
    const { port, close, hits } = await startServer((_req, res) =>
      res.writeHead(302, { location: "/a/b/info/refs?service=git-upload-pack" }).end(),
    );
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      expect(await isGitRepoUrl(`http://git.example.com:${port}/a/b`, { lookupImpl, isBlockedIp: allowAll })).toBe(false);
      expect(hits()).toBe(5);
    } finally {
      await close();
    }
  });

  test("DNS rebind during discovery cannot reach the private canary", async () => {
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
      const result = await isGitRepoUrl(`http://rebind-repo.test:${canaryPort}/me/thing`, { lookupImpl });
      expect(result).toBe(false);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(canaryHits).toBe(0);
    } finally {
      await new Promise((r) => canary.close(r));
    }
  });
});
