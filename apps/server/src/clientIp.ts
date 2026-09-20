// Shared "who is actually making this request" logic for rate limiting -
// used by both rateLimit.ts (plain HTTP, via Express) and gameServer.ts's
// WebSocket upgrade limiter (outside Express, no req.ip).
//
// PIXL is served through Cloudflare (confirmed: every response carries
// `server: cloudflare`/`cf-ray`), which always sets CF-Connecting-IP itself,
// overwriting anything the client sent - a client cannot forge this header's
// value the way it can freely rewrite X-Forwarded-For. That makes it
// authoritative regardless of how many additional internal hops (Hack
// Club's own ingress, etc.) sit between Cloudflare and this process, so
// this never has to know or guess that number. X-Forwarded-For hop-counting
// (Express's `trust proxy`) stays as the fallback for traffic that somehow
// reaches the origin without going through Cloudflare (local dev, direct
// origin access) - if that path is ever proven wrong, it now only affects
// the fallback, not the common case.
function looksLikeIp(v: string): boolean {
  return /^[0-9a-fA-F.:]+$/.test(v) && v.length <= 45;
}

export function realIpFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallback: string,
): string {
  const cf = headers["cf-connecting-ip"];
  const cfValue = Array.isArray(cf) ? cf[0] : cf;
  if (cfValue && looksLikeIp(cfValue.trim())) return cfValue.trim();
  return fallback;
}

// RFC 5952 "::" expansion, just enough to read off the first 4 groups - a
// full parse/validate isn't needed since the result is only ever used as a
// rate-limit bucket key, never re-serialized as a real address.
function expandGroups(ip: string): string[] {
  if (!ip.includes("::")) return ip.split(":");
  const [left, right] = ip.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  const missing = Math.max(0, 8 - leftParts.length - rightParts.length);
  return [...leftParts, ...Array(missing).fill("0"), ...rightParts];
}

// A single IPv6 address is a weak rate-limit key on its own - residential
// ISPs commonly hand out a whole /64 (sometimes /56) per customer, so
// limiting by the full address lets someone rotate through addresses in
// their own block and never hit the same bucket twice. Aggregate to /64,
// the smallest block size actually meant to identify one customer/site.
// IPv4 is unaffected - a /32 (the whole address) is already the right unit.
export function rateLimitIpKey(ip: string): string {
  if (!ip.includes(":")) return ip; // IPv4, or an opaque fallback like "unknown"
  const groups = expandGroups(ip);
  if (groups.length < 4) return ip; // not a well-formed address - key on it as-is
  return groups.slice(0, 4).join(":") + "::/64";
}
