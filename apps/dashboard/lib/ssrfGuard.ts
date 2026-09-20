// SSRF guard for outbound requests to a player-supplied host (repo_url's
// hostname, for an unrecognized git forge - see commits.ts). Ported from
// apps/server/src/routes/urlLiveness.ts rather than imported: each app's
// Docker build context is isolated (see pgCompat.ts's header comment), so a
// workspace import doesn't resolve here.
//
// apps/server's ship-time isGitRepoUrl check already validates repo_url this
// way, but only once, at ship time. This app fetches commits again on every
// review page view, potentially days later - a host that was public then can
// rebind its DNS to an internal address by the time a reviewer opens the
// page, so the check has to happen again here, immediately before the
// connection that actually sends any secret tokens (FORGEJO_TOKEN/
// GITLAB_TOKEN). Pinning DNS (not just checking it, then letting a plain
// fetch() re-resolve independently) closes the TOCTOU gap between the check
// and the connection.
import { lookup as dnsLookupPromise } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

export type LookupImpl = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;

const dnsLookup: LookupImpl = (hostname, options) => dnsLookupPromise(hostname, options);

export interface SsrfGuardDeps {
  lookupImpl?: LookupImpl;
  isBlockedIp?: (ip: string) => boolean;
  timeoutMs?: number;
  ca?: string | Buffer | Array<string | Buffer>; // test only
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true; // loopback / unspecified
    if (s.startsWith("::ffff:")) return isBlockedIp(s.slice(7)); // IPv4-mapped
    if (s.startsWith("fc") || s.startsWith("fd")) return true; // unique local
    if (s.startsWith("fe80")) return true; // link-local
    return false;
  }
  return true; // not a parseable IP - refuse rather than guess
}

export async function hostIsPublic(hostname: string, deps: SsrfGuardDeps = {}): Promise<boolean> {
  const lookupImpl = deps.lookupImpl ?? dnsLookup;
  const isBlocked = deps.isBlockedIp ?? isBlockedIp;
  if (isIP(hostname)) return !isBlocked(hostname);
  try {
    const addrs = await lookupImpl(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isBlocked(a.address));
  } catch {
    return false;
  }
}

type NodeLookupFunction = (
  hostname: string,
  options: { all?: boolean },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

// Resolves and connects with the same lookup, so the IP that's checked is
// the IP that's actually connected to - a plain fetch()/http.request() would
// resolve DNS again on its own, which is exactly the gap a rebind exploits.
function makeSafeLookup(lookupImpl: LookupImpl, isBlocked: (ip: string) => boolean): NodeLookupFunction {
  return function safeLookup(hostname, options, callback) {
    lookupImpl(hostname, { all: true }).then(
      (addrs) => {
        if (addrs.length === 0 || addrs.some((a) => isBlocked(a.address))) {
          callback(Object.assign(new Error("blocked target"), { code: "EBLOCKEDHOST" }), "");
          return;
        }
        if (options.all) callback(null, addrs);
        else callback(null, addrs[0].address, addrs[0].family);
      },
      (err) => callback(err, ""),
    );
  };
}

export interface SafeJsonResult {
  status: number;
  json: unknown;
}

interface ResolvedDeps {
  lookupImpl: LookupImpl;
  isBlockedIp: (ip: string) => boolean;
  timeoutMs: number;
  ca?: string | Buffer | Array<string | Buffer>;
}

function resolveDeps(deps: SsrfGuardDeps): ResolvedDeps {
  return {
    lookupImpl: deps.lookupImpl ?? dnsLookup,
    isBlockedIp: deps.isBlockedIp ?? isBlockedIp,
    timeoutMs: deps.timeoutMs ?? 8000,
    ca: deps.ca,
  };
}

function requestOnce(
  u: URL,
  headers: Record<string, string>,
  resolved: ResolvedDeps,
): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const reqOptions: https.RequestOptions = {
      method: "GET",
      headers,
      lookup: makeSafeLookup(resolved.lookupImpl, resolved.isBlockedIp),
      signal: AbortSignal.timeout(resolved.timeoutMs),
      agent: false, // no pooling - a pooled socket could outlive its own DNS pin
    };
    if (resolved.ca) reqOptions.ca = resolved.ca;
    const req = mod.request(
      u,
      reqOptions,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "private-token", "cookie"]);

function hasCredentials(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => CREDENTIAL_HEADERS.has(k.toLowerCase()));
}

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())));
}

function originOf(u: URL): string {
  return `${u.protocol}//${u.hostname.toLowerCase()}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
}

// GET only - every caller in commits.ts is a read. Re-validates the host on
// every redirect hop (a 200 from a public host that then 302s to
// 169.254.169.254 must not be followed blindly, same as urlAlive in
// apps/server/src/routes/urlLiveness.ts). Credential headers only ever go to
// the first URL's origin, over https; any other origin gets them stripped.
export async function safeJsonGet(
  url: string,
  headers: Record<string, string>,
  deps: SsrfGuardDeps = {},
): Promise<SafeJsonResult | null> {
  const resolved = resolveDeps(deps);
  let current = url;
  let credentialed = hasCredentials(headers);
  let firstOrigin = "";
  for (let hop = 0; hop < 5; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!(await hostIsPublic(u.hostname, resolved))) return null;
    const origin = originOf(u);
    if (hop === 0) firstOrigin = origin;
    if (credentialed) {
      if (u.protocol !== "https:") return null;
      if (origin !== firstOrigin) credentialed = false;
    }
    let r: { status: number; location: string | null; body: string };
    try {
      r = await requestOnce(u, credentialed ? headers : withoutCredentials(headers), resolved);
    } catch {
      return null;
    }
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) return null;
      current = new URL(r.location, current).toString();
      continue;
    }
    let json: unknown = null;
    try {
      json = r.body ? JSON.parse(r.body) : null;
    } catch {
      json = null;
    }
    return { status: r.status, json };
  }
  return null; // too many redirects
}
