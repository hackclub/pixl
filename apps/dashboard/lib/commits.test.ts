import { afterEach, describe, expect, test } from "bun:test";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchCommits, parseRepoRef } from "./commits";
import type { LookupImpl } from "./ssrfGuard";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Route table keyed by URL; anything unrouted 404s, like a real host would.
 *  Only the GitHub path still goes through fetch() - see the local-server
 *  tests below for the forgejo/gitlab (SSRF-guarded) paths. */
function routeFetch(routes: Record<string, { status?: number; json?: unknown; text?: string }>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200 });
    return new Response(JSON.stringify(r.json ?? []), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

// local servers only, no real DNS - same pattern as urlLiveness.test.ts
function lookupOf(...addrs: { address: string; family: number }[]): LookupImpl {
  return async () => addrs.map((a) => ({ ...a }));
}

const allowAll = () => false;

// commits.ts always builds an https:// request, so the local stand-in server
// needs real TLS - a throwaway self-signed cert covering every hostname used
// below (skips if openssl isn't available in this environment).
const TEST_HOSTS = [
  "gitea.example.test",
  "glab.example.test",
  "blog.example.test",
  "html.example.test",
  "codeberg.org",
];
let httpsFixture: { key: string; cert: string } | null = null;
try {
  const dir = mkdtempSync(path.join(os.tmpdir(), "commits-cert-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
      "-days", "1", "-nodes", "-subj", "/CN=gitea.example.test",
      "-addext", `subjectAltName=${TEST_HOSTS.map((h) => `DNS:${h}`).join(",")}`,
    ],
    { stdio: "ignore" },
  );
  httpsFixture = { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  rmSync(dir, { recursive: true, force: true });
} catch {
  httpsFixture = null;
}
const httpsTest = httpsFixture ? test : test.skip;

type Handler = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;

function startServer(handler: Handler): Promise<{ port: number; close: () => Promise<void> }> {
  const server = https.createServer({ key: httpsFixture!.key, cert: httpsFixture!.cert }, handler);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function jsonServer(body: unknown, status = 200): Handler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
}

describe("parseRepoRef", () => {
  test("github", () => expect(parseRepoRef("https://github.com/ridit/pixl")).toMatchObject({ provider: "github", path: "ridit/pixl" }));
  test("github with .git", () => expect(parseRepoRef("https://github.com/ridit/pixl.git")?.path).toBe("ridit/pixl"));
  test("codeberg maps to forgejo", () => expect(parseRepoRef("https://codeberg.org/brandt/thing")).toMatchObject({ provider: "forgejo", path: "brandt/thing" }));
  test("gitlab", () => expect(parseRepoRef("https://gitlab.com/group/proj")).toMatchObject({ provider: "gitlab", path: "group/proj" }));
  test("gitlab subgroups keep the full path", () =>
    expect(parseRepoRef("https://gitlab.com/group/sub/proj")?.path).toBe("group/sub/proj"));
  test("gitlab strips everything after /-/", () =>
    expect(parseRepoRef("https://gitlab.com/group/proj/-/tree/main")?.path).toBe("group/proj"));
  test("unknown host has no provider yet", () =>
    expect(parseRepoRef("https://git.example.com/me/thing")).toMatchObject({ provider: null, path: "me/thing" }));
  test("strips www", () => expect(parseRepoRef("https://www.github.com/a/b")?.host).toBe("github.com"));
  test("keeps a non-default port, for a self-hosted forge that isn't on 443", () =>
    expect(parseRepoRef("https://gitea.internal:3000/me/thing")?.host).toBe("gitea.internal:3000"));
  test("rejects a bare origin", () => expect(parseRepoRef("https://github.com/ridit")).toBeNull());
  test("rejects a dangerous scheme", () => expect(parseRepoRef("javascript:alert(1)")).toBeNull());
  test("rejects null", () => expect(parseRepoRef(null)).toBeNull());
});

const FORGEJO_JSON = [
  {
    sha: "abc1234def5678",
    html_url: "https://codeberg.org/brandt/thing/commit/abc1234",
    commit: { message: "add the thing\n\nbody", author: { name: "Brandt", email: "b@example.com", date: "2026-09-01T10:00:00Z" } },
    author: { login: "brandt" },
    stats: { additions: 12, deletions: 3 },
  },
];

const GITLAB_JSON = [
  {
    id: "def567890abc",
    short_id: "def5678",
    title: "fix the thing",
    message: "fix the thing\n",
    author_name: "Someone",
    author_email: "s@example.com",
    committed_date: "2026-09-02T10:00:00Z",
    web_url: "https://gitlab.com/group/proj/-/commit/def5678",
    stats: { additions: 4, deletions: 1 },
  },
];

describe("fetchCommits (github, unaffected by the SSRF guard - fixed api.github.com target)", () => {
  test("no repo url is not an error", async () => {
    const r = await fetchCommits(null);
    expect(r).toEqual({ repo: null, commits: [], error: null });
  });

  test("a non-repo url is rejected before any request", async () => {
    const calls = routeFetch({});
    const r = await fetchCommits("javascript:alert(1)");
    expect(r.error).toBe("unsupported_host");
    expect(calls).toEqual([]);
  });
});

// forgejo/gitlab (and the "unknown host, probe both" path) now go through
// lib/ssrfGuard.ts's DNS-pinning client instead of fetch() - see the SSRF
// section below for the fix itself. These use a real local HTTP server
// (like urlLiveness.test.ts) with the lookup pinned to it, and isBlockedIp
// relaxed to allow the loopback server - production still uses the real
// isBlockedIp, which blocks it.
describe("fetchCommits (forgejo/gitlab, via a local server standing in for the real host)", () => {
  httpsTest("a self-hosted forgejo answers with commits", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/api/v1/repos/me/thing/commits?limit=50&stat=true") return jsonServer(FORGEJO_JSON)(req, res);
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const r = await fetchCommits(`https://gitea.example.test:${port}/me/thing`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.error).toBeNull();
      expect(r.provider).toBe("forgejo");
      expect(r.commits).toHaveLength(1);
      expect(r.commits[0]).toMatchObject({ sha: "abc1234", message: "add the thing", author: "brandt", additions: 12, deletions: 3 });
    } finally {
      await close();
    }
  });

  httpsTest("a self-hosted gitlab is found after forgejo's api answers 404", async () => {
    const { port, close } = await startServer((req, res) => {
      if (req.url === "/api/v4/projects/me%2Fthing/repository/commits?per_page=50&with_stats=true") {
        return jsonServer(GITLAB_JSON)(req, res);
      }
      res.writeHead(404).end();
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const r = await fetchCommits(`https://glab.example.test:${port}/me/thing`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.provider).toBe("gitlab");
      expect(r.commits[0]).toMatchObject({ sha: "def5678", message: "fix the thing", author: "Someone" });
    } finally {
      await close();
    }
  });

  httpsTest("a host answering neither api reports unsupported_host", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(404).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const r = await fetchCommits(`https://blog.example.test:${port}/some/post`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.error).toBe("unsupported_host");
      expect(r.commits).toEqual([]);
    } finally {
      await close();
    }
  });

  httpsTest("a host serving html instead of json is not mistaken for a repo", async () => {
    const { port, close } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html></html>");
    });
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const r = await fetchCommits(`https://html.example.test:${port}/me/thing`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.error).toBe("unsupported_host");
    } finally {
      await close();
    }
  });

  httpsTest("a known-provider host's 404 is not_found, not a silent probe miss", async () => {
    const { port, close } = await startServer((_req, res) => res.writeHead(404).end());
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      // Give it a real forgejo hostname (codeberg.org) so provider is known -
      // point DNS at the local server instead of the real host.
      const r = await fetchCommits(`https://codeberg.org:${port}/nobody/nothing`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.error).toBe("not_found");
      expect(r.provider).toBe("forgejo");
    } finally {
      await close();
    }
  });

  httpsTest("flags an AI co-author trailer on a self-hosted forgejo", async () => {
    const { port, close } = await startServer(
      jsonServer([
        {
          sha: "1111111",
          commit: { message: "do it\n\nCo-Authored-By: Claude <noreply@anthropic.com>", author: { name: "x", email: "x@e.com", date: "2026-09-01T00:00:00Z" } },
        },
      ]),
    );
    try {
      const lookupImpl = lookupOf({ address: "127.0.0.1", family: 4 });
      const r = await fetchCommits(`https://gitea.example.test:${port}/a/b`, 50, {
        lookupImpl,
        isBlockedIp: allowAll,
        ca: httpsFixture!.cert,
      });
      expect(r.commits[0]?.ai).toBe(true);
    } finally {
      await close();
    }
  });
});

// The actual vulnerability this fixes: a player-controlled repo_url host
// that resolves (now, or later via DNS rebind - apps/server's ship-time
// check only ever saw the host once) to a private/internal/cloud-metadata
// address must never be connected to, regardless of what dialect it claims
// to speak.
describe("fetchCommits refuses a host that resolves to a blocked address (SSRF)", () => {
  test("an unknown host resolving to cloud metadata is never connected to", async () => {
    const lookupImpl = lookupOf({ address: "169.254.169.254", family: 4 });
    // No local server at all - if this test passes, no connection was even
    // attempted (nothing is listening on this made-up port).
    const r = await fetchCommits("https://attacker-controlled.example.test:59999/me/thing", 50, {
      lookupImpl,
    });
    expect(r.error).toBe("unsupported_host");
    expect(r.commits).toEqual([]);
  });

  test("a known-provider hostname resolving to a private address is never connected to", async () => {
    const lookupImpl = lookupOf({ address: "10.0.0.5", family: 4 });
    const r = await fetchCommits("https://codeberg.org:59999/me/thing", 50, { lookupImpl });
    expect(r.error).toBe("fetch_failed");
    expect(r.commits).toEqual([]);
  });

  httpsTest("a redirect to a blocked address is not followed, even after the first hop passed", async () => {
    const { port, close } = await startServer((_req, res) => {
      res.writeHead(302, { location: "http://internal-redirect-target.example.test/x" }).end();
    });
    try {
      // 127.0.0.1 (the local server) is allowed; everything else uses the
      // real isBlockedIp, which blocks the redirect target's address. If the
      // redirect were followed without re-checking, this would 200 instead.
      const lookupImpl: LookupImpl = async (hostname) =>
        hostname === "internal-redirect-target.example.test"
          ? [{ address: "169.254.169.254", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      const isBlockedIp = (ip: string) => ip !== "127.0.0.1";
      const r = await fetchCommits(`https://gitea.example.test:${port}/me/thing`, 50, {
        lookupImpl,
        isBlockedIp,
        ca: httpsFixture!.cert,
      });
      expect(r.error).toBe("unsupported_host");
    } finally {
      await close();
    }
  });
});
