import type { IncomingHttpHeaders } from "node:http";
import { BlockList, isIP } from "node:net";

const CLOUDFLARE_CIDRS = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const cidr of CLOUDFLARE_CIDRS) {
  const [addr, bits] = cidr.split("/");
  cloudflare.addSubnet(addr, Number(bits), addr.includes(":") ? "ipv6" : "ipv4");
}

type HeaderValue = string | string[] | null | undefined;

export interface ClientIpInput {
  remoteAddress?: string | null;
  xForwardedFor?: HeaderValue;
  cfConnectingIp?: HeaderValue;
}

const hex = (n: number) => n.toString(16);

function ipv6Groups(ip: string): number[] {
  let text = ip;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${hex((a << 8) | b)}:${hex((c << 8) | d)}`;
  }
  const [head, rest] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = text.includes("::") ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(fill).fill("0"), ...right].map((g) => parseInt(g, 16));
}

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes("%")) return null;
  const groups = ipv6Groups(value);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return groups.map(hex).join(":");
}

export function isCloudflareAddress(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  return cloudflare.check(normalized, normalized.includes(":") ? "ipv6" : "ipv4");
}

function ingressPeer(input: ClientIpInput): string | null {
  const forwarded = Array.isArray(input.xForwardedFor) ? input.xForwardedFor.join(",") : input.xForwardedFor;
  return normalizeIp(forwarded?.split(",").pop()) ?? normalizeIp(input.remoteAddress);
}

function singleValue(value: HeaderValue): string | null {
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.length === 1 ? value[0] : null;
}

export function clientIpFrom(input: ClientIpInput): string {
  const peer = ingressPeer(input);
  if (!peer) return "unknown";
  if (!isCloudflareAddress(peer)) return peer;
  return normalizeIp(singleValue(input.cfConnectingIp)) ?? peer;
}

export function rateLimitIpKey(ip: string): string {
  const normalized = normalizeIp(ip);
  if (!normalized) return "unknown";
  if (!normalized.includes(":")) return normalized;
  return `${normalized.split(":").slice(0, 4).join(":")}::/64`;
}

export function requestIpKey(req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }): string {
  return rateLimitIpKey(
    clientIpFrom({
      remoteAddress: req.socket.remoteAddress,
      xForwardedFor: req.headers["x-forwarded-for"],
      cfConnectingIp: req.headers["cf-connecting-ip"],
    }),
  );
}
