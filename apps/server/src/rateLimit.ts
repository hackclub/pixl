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

const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();
    const key = `${opts.name}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    next();
  };
}
