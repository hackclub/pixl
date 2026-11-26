import { lookup as dnsLookupPromise } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";

// SSRF guard, pins DNS so it can't rebind.
export type LookupImpl = (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;

const dnsLookup: LookupImpl = (hostname, options) => dnsLookupPromise(hostname, options);

export interface UrlLivenessDeps {
  lookupImpl?: LookupImpl;
  isBlockedIp?: (ip: string) => boolean;
  timeoutMs?: number;
  ca?: string | Buffer | Array<string | Buffer>; // test only
}

// An IPv6 address as its 8 16-bit groups (an embedded dotted IPv4 tail is
// folded into the last two), or null.
export function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    if (isIP(v4[1]) !== 4) return null;
    const [a, b, c, d] = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a >= 224) return true; // 224.0.0.0/3: multicast, reserved, broadcast
    return false;
  }
  if (v === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (zeroTo(8)) return true; // ::
    if (zeroTo(7) && g[7] === 1) return true; // ::1
    // IPv4-mapped (::ffff:a.b.c.d, in any spelling) and the deprecated
    // IPv4-compatible (::a.b.c.d): judge the embedded IPv4 address.
    if (zeroTo(5) && g[5] === 0xffff) return isBlockedIp(v4FromGroups(g[6], g[7]));
    if (zeroTo(6)) return isBlockedIp(v4FromGroups(g[6], g[7]));
    // NAT64 64:ff9b::/96 and 6to4 2002::/16 both carry an IPv4 address that
    // the network may route to: judge that address, refuse if it's internal.
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
      return isBlockedIp(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x2002) return true; // 6to4: refuse outright, no real host needs it
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not a parseable IP - refuse rather than guess
}

export async function hostIsPublic(hostname: string, deps: UrlLivenessDeps = {}): Promise<boolean> {
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

// resolves and connects with the same lookup
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

// Roblox's WAF blocks the bot-shaped HEAD/GET requests urlAlive sends (no browser
// UA, no cookies) even for a game that's genuinely live and playable , every
// roblox.com demo link was getting rejected as "unreachable". Skip the fetch for
// these hosts once the SSRF guard clears them; still no bypass of hostIsPublic.
// share.streamlit.io answers 444 to every request from the cluster's egress IP,
// and every *.streamlit.app demo bounces through it first. The app's own host is
// still fetched, but Streamlit bounces live and nonexistent apps alike, so a
// dead Streamlit link passes too (reviewers still open the demo).
const TRUSTED_UNFETCHABLE_HOSTS = new Set(["roblox.com", "share.streamlit.io"]);

export function isTrustedUnfetchableHost(hostname: string): boolean {
  return TRUSTED_UNFETCHABLE_HOSTS.has(hostname.replace(/^www\./, "").toLowerCase());
}

export interface SafeResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  bodyPrefix: string;
  setCookies: string[];
}

export interface SafeRequestOptions {
  method: "HEAD" | "GET";
  headers?: Record<string, string>;
  readBodyPrefix?: boolean;
}

interface ResolvedDeps {
  lookupImpl: LookupImpl;
  isBlockedIp: (ip: string) => boolean;
  timeoutMs: number;
  ca?: string | Buffer | Array<string | Buffer>;
}

function resolveDeps(deps: UrlLivenessDeps): ResolvedDeps {
  return {
    lookupImpl: deps.lookupImpl ?? dnsLookup,
    isBlockedIp: deps.isBlockedIp ?? isBlockedIp,
    timeoutMs: deps.timeoutMs ?? 8000,
    ca: deps.ca,
  };
}

const BODY_PREFIX_BYTES = 256;

// first chunk only, then stop
function readBodyPrefix(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (text: string) => {
      if (done) return;
      done = true;
      res.destroy();
      resolve(text);
    };
    res.once("data", (chunk: Buffer) => finish(chunk.toString("utf8").slice(0, BODY_PREFIX_BYTES)));
    res.once("end", () => finish(""));
    res.once("error", () => finish(""));
  });
}

// no fetch, can't pin its DNS
export function safeRequest(u: URL, options: SafeRequestOptions, deps: UrlLivenessDeps = {}): Promise<SafeResponse> {
  const resolved = resolveDeps(deps);
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const reqOptions: https.RequestOptions = {
      method: options.method,
      headers: options.headers,
      lookup: makeSafeLookup(resolved.lookupImpl, resolved.isBlockedIp),
      signal: AbortSignal.timeout(resolved.timeoutMs),
      agent: false, // no pooling
    };
    if (resolved.ca) reqOptions.ca = resolved.ca;
    const req = mod.request(u, reqOptions, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location ?? null;
      const contentType = res.headers["content-type"] ?? null;
      const setCookies = res.headers["set-cookie"] ?? [];
      if (options.readBodyPrefix) {
        readBodyPrefix(res).then((bodyPrefix) => resolve({ status, location, contentType, bodyPrefix, setCookies }));
        return;
      }
      res.resume(); // discard body
      resolve({ status, location, contentType, bodyPrefix: "", setCookies });
    });
    req.on("error", reject);
    req.end();
  });
}

// Minimal per-host cookie jar for one urlAlive call. Streamlit Community Cloud
// (and similar) bounce through an auth hop that sets a session cookie and
// redirects back; without replaying it the chain loops until the hop cap.
// Exact-host match only, attributes ignored, never sent to another host.
type CookieJar = Map<string, Map<string, string>>;

function storeCookies(jar: CookieJar, host: string, setCookies: string[]): void {
  for (const raw of setCookies) {
    const pair = raw.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const hostJar = jar.get(host) ?? new Map<string, string>();
    if (!value || /;\s*max-age=0\b/i.test(raw)) hostJar.delete(name);
    else hostJar.set(name, value);
    jar.set(host, hostJar);
  }
}

function cookieHeader(jar: CookieJar, host: string): Record<string, string> | undefined {
  const hostJar = jar.get(host);
  if (!hostJar || hostJar.size === 0) return undefined;
  return { cookie: [...hostJar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

// Streamlit's auth bounce alone is 4 requests, so 5 left one hop of slack.
const MAX_HOPS = 8;

// One retry for a transient network failure (reset, timeout) on a hop. A blocked
// host is a verdict, not a blip, so it is never retried.
async function requestWithRetry(
  u: URL,
  options: SafeRequestOptions,
  deps: ResolvedDeps,
): Promise<SafeResponse> {
  try {
    return await safeRequest(u, options, deps);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EBLOCKEDHOST") throw e;
    return safeRequest(u, options, deps);
  }
}

export async function urlAlive(url: string, deps: UrlLivenessDeps = {}): Promise<boolean> {
  // re-validate host on every hop
  const resolved = resolveDeps(deps);
  const jar: CookieJar = new Map();
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (!(await hostIsPublic(u.hostname, resolved))) return false;
    if (isTrustedUnfetchableHost(u.hostname)) return true;
    try {
      const headers = cookieHeader(jar, u.host);
      let r = await requestWithRetry(u, { method: "HEAD", headers }, resolved);
      if (r.status === 405 || r.status === 501) r = await requestWithRetry(u, { method: "GET", headers }, resolved);
      storeCookies(jar, u.host, r.setCookies);
      if (r.status >= 300 && r.status < 400) {
        if (!r.location) return false;
        current = new URL(r.location, current).toString();
        continue;
      }
      return (r.status >= 200 && r.status < 300) || r.status === 401 || r.status === 403;
    } catch {
      return false;
    }
  }
  return false; // too many redirects
}
