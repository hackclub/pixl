import type { Request, Response, NextFunction } from "express";

// Fixed-window in-memory rate limiter keyed by IP. Relies on `trust proxy`
// being set in index.ts so req.ip is the platform proxy's own account of the
// client address, not a header a client can freely rewrite, never read
// X-Forwarded-For directly here. Good enough for a single instance; swap for
// Redis if the server ever scales horizontally.
interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly name: string;
  readonly key?: (req: Request) => string;
}

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

export function consumeRateLimit(opts: RateLimitOptions, key: string): number | null {
  const bucketKey = `${opts.name}:${key}`;
  const now = Date.now();
  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(bucketKey, bucket);
  }
  bucket.count++;
  return bucket.count > opts.max ? Math.ceil((bucket.resetAt - now) / 1000) : null;
}

export function rateLimit(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();
    const retryAfter = consumeRateLimit(opts, opts.key?.(req) ?? req.ip ?? "unknown");
    if (retryAfter !== null) {
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    next();
  };
}
