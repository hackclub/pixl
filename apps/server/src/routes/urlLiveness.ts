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
const TRUSTED_UNFETCHABLE_HOSTS = new Set(["roblox.com"]);

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

export async function urlAlive(url: string, deps: UrlLivenessDeps = {}): Promise<boolean> {
  // re-validate host on every hop
  const resolved = resolveDeps(deps);
  const jar: CookieJar = new Map();
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
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
      let r = await safeRequest(u, { method: "HEAD", headers }, resolved);
      if (r.status === 405 || r.status === 501) r = await safeRequest(u, { method: "GET", headers }, resolved);
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
