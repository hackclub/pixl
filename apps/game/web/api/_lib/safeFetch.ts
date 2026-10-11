// Guards against SSRF when fetching a URL that ultimately comes from
// user/DB-sourced data (a project's image_url, a player's avatar_url, a shop
// item's image_url) rather than a literal in this codebase. Used by the OG
// card handlers through ./cardImage.ts.
//
// Checks: scheme must be http/https, hostname can't be localhost/0.0.0.0,
// and every IP the hostname resolves to must be public (no loopback, private,
// link-local, carrier-grade NAT, multicast or reserved range, including IPv4
// wrapped inside an IPv6 address). Redirects are followed by hand so every
// hop goes through the same check - fetch's own redirect following would
// carry a vetted public URL's 302 straight to an internal address. Bodies are
// capped so a huge file can't be buffered into memory.
//
// This doesn't defend against DNS rebinding between the check and the actual
// fetch - fetch doesn't expose a way to pin the resolved IP for one call - but
// it stops pointing an image at an internal service or the cloud metadata
// endpoint, directly or through a redirect.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

export const MAX_FETCH_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BLOCKED_V4: [base: string, bits: number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT, also used inside some clusters
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. the cloud metadata endpoint
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inRange(ip: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => inRange(n, base, bits));
}

// Expands any IPv6 spelling (::, an embedded dotted quad) to its eight 16-bit
// groups, or null if it doesn't parse.
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right].map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

function isPrivateV6(ip: string): boolean {
  // A zone id (fe80::1%eth0) only ever names a local interface.
  if (ip.includes("%")) return true;
  const g = ipv6Groups(ip);
  if (!g) return true; // can't tell what it is, so don't fetch it
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (zero(0, 8)) return true; // ::
  if (zero(0, 7) && g[7] === 1) return true; // ::1
  if (zero(0, 5) && g[5] === 0xffff) return isPrivateV4(embeddedV4()); // ::ffff:a.b.c.d
  if (zero(0, 6)) return isPrivateV4(embeddedV4()); // ::a.b.c.d (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return isPrivateV4(embeddedV4()); // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Throws if `rawUrl` isn't safe to fetch server-side: bad scheme, a
 * blocked hostname literal, or a hostname that resolves to a non-public
 * address.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`blocked scheme: ${url.protocol}`);
  }

  // URL keeps the brackets on an IPv6 literal ("[::1]"), which lookup()
  // can't resolve.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`blocked hostname: ${hostname}`);
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`could not resolve hostname: ${hostname}`);
  }
  for (const { address, family } of addresses) {
    if (family === 4 ? isPrivateV4(address) : isPrivateV6(address)) {
      throw new Error(`hostname resolves to a private address: ${hostname} -> ${address}`);
    }
  }

  return url;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(`response too large: ${declared} bytes`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Fetches `rawUrl` and returns its body, or null for a non-2xx response.
 * Every redirect hop goes back through assertSafeUrl (at most MAX_REDIRECTS
 * of them), and all hops plus reading the body share one timeout. Throws if
 * a hop is blocked, there are too many redirects, or the body is bigger than
 * maxBytes.
 */
export async function safeFetchBytes(
  rawUrl: string,
  { maxBytes = MAX_FETCH_BYTES, timeoutMs = 10_000 }: SafeFetchOptions = {},
): Promise<Uint8Array | null> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = await assertSafeUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { redirect: "manual", signal });
    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel();
      const location = res.headers.get("location");
      if (!location) return null;
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects: ${rawUrl}`);
      url = await assertSafeUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return readCapped(res, maxBytes);
  }
}
