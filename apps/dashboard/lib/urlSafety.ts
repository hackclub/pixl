// Guards server-side fetches of admin-supplied URLs (e.g. CSV bulk-import
// image URLs) against SSRF: internal/private targets, non-http(s) schemes,
// and DNS-rebinding (a public hostname that resolves to a private IP).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function ipToUint32(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToUint32(ip) & mask) === (ipToUint32(base) & mask);
}

function isPrivateIpv4(ip: string): boolean {
  return (
    inCidr(ip, "127.0.0.0", 8) ||
    inCidr(ip, "10.0.0.0", 8) ||
    inCidr(ip, "172.16.0.0", 12) ||
    inCidr(ip, "192.168.0.0", 16) ||
    inCidr(ip, "169.254.0.0", 16) ||
    ip === "0.0.0.0"
  );
}

function isPrivateIpv6(ip: string): boolean {
  const norm = ip.toLowerCase();
  return (
    norm === "::1" ||
    norm === "::" ||
    norm.startsWith("fc") || // fc00::/7 (fc.. and fd..)
    norm.startsWith("fd") ||
    norm.startsWith("fe8") || // fe80::/10 link-local (fe80-febf)
    norm.startsWith("fe9") ||
    norm.startsWith("fea") ||
    norm.startsWith("feb") ||
    // IPv4-mapped IPv6 (::ffff:a.b.c.d), check the embedded IPv4 too.
    (norm.startsWith("::ffff:") && isPrivateIpv4(norm.slice(7)))
  );
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // unrecognized -> refuse rather than risk it
}

// Throws with a human-readable message if `raw` is not safe to fetch
// server-side. Callers should catch and treat this as a per-item failure,
// not let it bubble up and abort a whole batch.
export async function assertSafeExternalUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported URL scheme (${url.protocol})`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new Error("URL host is not allowed");
  }
  // A bare IP literal in the hostname (dns.lookup would just hand it back).
  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error("URL resolves to a private address");
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("could not resolve URL host");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error("URL resolves to a private address");
  }
}
