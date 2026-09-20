const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fixed-window in-memory limiter, same shape as apps/server's rateLimit.ts
// but self-contained - this is the only route in this app that needs one.
// Served through Cloudflare (pixl.hackclub.com), so CF-Connecting-IP is
// authoritative regardless of any internal hop count - see apps/server's
// clientIp.ts for the fuller reasoning, same logic, smaller scope here.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > MAX_PER_WINDOW;
}

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const { email } = await req.json().catch(() => ({}) as { email?: unknown });
  if (!email) return Response.json({ ok: false, error: "missing_email" }, { status: 400 });
  if (typeof email !== "string" || email.length > 254 || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const baseUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Signups`;
  const authHeader = `Bearer ${process.env.AIRTABLE_TOKEN}`;

  // Escape backslashes before quotes , escaping quotes alone lets a
  // "\" + '"' pair in the input smuggle an unescaped quote through and
  // close the formula string literal early (Airtable formula injection).
  const escapedEmail = email.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const filter = encodeURIComponent(`{Email} = "${escapedEmail}"`);
  const existing = await fetch(
    `${baseUrl}?filterByFormula=${filter}&maxRecords=1`,
    { headers: { Authorization: authHeader }, signal: AbortSignal.timeout(10_000) },
  );
  if (!existing.ok) {
    console.error("[rsvp] Airtable lookup failed", existing.status);
    return Response.json({ ok: false, error: "signup_failed" }, { status: 502 });
  }
  const existingData = (await existing.json()) as { records?: unknown[] };
  if (existingData.records && existingData.records.length > 0) {
    return Response.json({ ok: true, skipped: true });
  }

  const res = await fetch(
    baseUrl,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { Email: email } }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    console.error("[rsvp] Airtable insert failed", res.status);
    return Response.json({ ok: false, error: "signup_failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
