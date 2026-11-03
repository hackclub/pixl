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

function isBlockedIpv4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments (192.0.0.0/24)
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (198.18.0.0/15)
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast (224/4), reserved (240/4), broadcast 255.255.255.255
  return false;
}

// "::7f00:1", "::ffff:127.0.0.1", "fe80::1%eth0" -> eight 16-bit groups, or
// null if it doesn't parse. Prefix checks on the raw string miss the many
// spellings of one address, so every IPv6 rule below works on the numbers.
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // A dotted IPv4 tail ("::ffff:1.2.3.4") becomes its two groups.
  const tail = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const o = tail.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${s.slice(0, -tail[0].length)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":").map((g) => parseInt(g, 16)));
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...rest];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip.split("%")[0]);
  if (v === 4) return isBlockedIpv4(ip);
  if (v === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (zeros(5) && g[5] === 0xffff) return isBlockedIpv4(v4(g[6], g[7])); // IPv4-mapped ::ffff:a.b.c.d
    if (zeros(6)) return true; // ::, ::1 and IPv4-compatible ::a.b.c.d (e.g. ::7f00:1)
    if (zeros(4) && g[4] === 0xffff && g[5] === 0) return true; // IPv4-translated ::ffff:0:a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 (64:ff9b::/96 and 64:ff9b:1::/48)
    if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard 100::/64
    if (g[0] === 0x2002) return true; // 6to4 (embeds an arbitrary IPv4)
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo (embeds an IPv4)
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10 (fe80-febf)
    if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
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

// Public Git hosts can return arbitrarily large bodies; commit evidence only
// needs a bounded JSON response. Enforce this before buffering any bytes.
export const MAX_SAFE_JSON_BYTES = 2 * 1024 * 1024;

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
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        // A redirect's body is irrelevant; do not buffer a host-controlled
        // response just to read its Location header.
        if (status >= 300 && status < 400) {
          resolve({ status, location, body: "" });
          res.destroy();
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > MAX_SAFE_JSON_BYTES) {
          reject(new Error("response too large"));
          res.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > MAX_SAFE_JSON_BYTES) {
            reject(new Error("response too large"));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }),
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
// apps/server/src/routes/urlLiveness.ts).
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

export interface SafeBinaryOptions extends SsrfGuardDeps {
  maxBytes: number;
}

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

// GET a binary body (e.g. an admin-supplied shop image URL) through the same
// pinned DNS lookup as safeJsonGet, so the address that was checked is the
// address connected to (no DNS rebinding between check and fetch). Redirects
// are refused outright rather than followed, and the body is streamed with a
// hard byte cap: the transfer is aborted as soon as it passes maxBytes, before
// anything large is buffered (a Content-Length over the cap is refused before
// reading at all). Throws SafeFetchError with a human-readable reason.
export async function safeBinaryGet(url: string, opts: SafeBinaryOptions): Promise<Buffer> {
  const resolved = resolveDeps(opts);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SafeFetchError("invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new SafeFetchError(`unsupported URL scheme (${u.protocol})`);
  if (u.username || u.password) throw new SafeFetchError("URLs with credentials are not allowed");
  if (!(await hostIsPublic(u.hostname, resolved))) throw new SafeFetchError("URL resolves to a private address");
  return new Promise<Buffer>((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const reqOptions: https.RequestOptions = {
      method: "GET",
      headers: { accept: "image/png,image/jpeg,image/webp,*/*;q=0.1" },
      lookup: makeSafeLookup(resolved.lookupImpl, resolved.isBlockedIp),
      signal: AbortSignal.timeout(resolved.timeoutMs),
      agent: false,
    };
    if (resolved.ca) reqOptions.ca = resolved.ca;
    const req = mod.request(u, reqOptions, (res) => {
      const status = res.statusCode ?? 0;
      const fail = (msg: string) => {
        res.destroy();
        req.destroy();
        reject(new SafeFetchError(msg));
      };
      if (status >= 300 && status < 400) return fail("image URL redirected, refusing to follow");
      if (status < 200 || status >= 300) return fail(`image fetch failed (${status})`);
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > opts.maxBytes) return fail("image is too large");
      const chunks: Buffer[] = [];
      let total = 0;
      let done = false;
      res.on("data", (c: Buffer) => {
        if (done) return;
        total += c.length;
        if (total > opts.maxBytes) {
          done = true;
          fail("image is too large");
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks));
      });
      res.on("error", (e) => {
        if (done) return;
        done = true;
        reject(e instanceof SafeFetchError ? e : new SafeFetchError("image download failed"));
      });
    });
    req.on("error", (e) => reject(e instanceof SafeFetchError ? e : new SafeFetchError("could not fetch image URL")));
    req.end();
  });
}
